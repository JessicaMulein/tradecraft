/**
 * Properties 9 and 10 (street-ops task 9). A search never finds a spot it
 * cannot reach. A concealed passenger who has outlasted the spot is found by
 * every search that can.
 *
 * **Validates: Requirements 9.3, 9.5, 9.6**
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
  type ContentSet,
  type DifficultyPreset,
} from '@tradecraft/content';

import { quote, resolve } from '../action/action.js';
import type { ResolverContext } from '../action/result.js';
import { ScenarioConfigSchema, type ScenarioConfig } from '../config/scenario-config.js';
import { generate, type GenerateInputs } from '../generate.js';
import type { NpcId, Phase } from '../model/core.js';
import type { WorldState } from '../model/state.js';
import { createPrng } from '../prng/prng.js';
import { newRelationship } from '../recruit/asset.js';
import { TruthStore } from '../truth/truth.js';
import { DIRECTIVE_OBJECTIVE_KINDS } from '../station/directive-types.js';
import { streetOpsAddOn, streetOpsRegistry } from './addon.js';
import { vehicleCheck, SEARCH_LEVELS, type SearchLevel } from './checkpoint.js';
import { CheckpointKindSchema } from './content.js';
import { driveCandidates, runtimeFromScenario } from './drive.js';
import { compileStreetGraph, gridGraph } from './graph.js';
import {
  board,
  composureFor,
  isSmuggleMet,
  STRAIN_LINE,
  syncConcealment,
  type PassengerView,
} from './passenger.js';

const CORE_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', 'content', 'packs', 'core');
const LEVELS = ['visual', 'interior', 'boot', 'undercarriage'] as const satisfies readonly SearchLevel[];

function kindFor(level: SearchLevel, thoroughness: number) {
  return CheckpointKindSchema.parse({
    id: 'post',
    borderCheck: 'pass',
    thoroughness,
    strictness: 0,
    hours: ['morning', 'afternoon', 'evening', 'night'],
    searches: [level],
    watchesAvoidance: false,
    avoidanceSuspicion: 0,
  });
}

describe('passengers and concealment', () => {
  it('never finds a spot the search cannot reach', () => {
    // Feature: street-ops, Property 9: Search reach
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 0.999, noNaN: true }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.constantFrom(...LEVELS),
        fc.constantFrom('item', 'passenger'),
        (draw, thoroughness, suspicion, level, cargoKind) => {
          const others = SEARCH_LEVELS.filter((item) => item !== 'none' && item !== level);
          const result = vehicleCheck(
            {
              vehicle: { id: 'car', plate: 'P-1' },
              passengers: [],
              concealment: [
                {
                  id: 'hidden',
                  difficulty: 0,
                  endurance: 1,
                  ticksConcealed: 40,
                  composure: 0,
                  kind: cargoKind,
                  reachedBy: others,
                },
              ],
              kind: kindFor(level, thoroughness),
              papersValid: true,
              onWatch: false,
              suspicion,
            },
            draw,
          );
          expect(result.search).toBe(level);
          expect(result.found).toEqual([]);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('finds a concealed passenger who has passed the spot endurance', () => {
    // Feature: street-ops, Property 10: Endurance
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 0.999, noNaN: true }),
        fc.double({ min: 0.2, max: 8, noNaN: true }),
        fc.double({ min: 0.01, max: 4, noNaN: true }),
        fc.constantFrom(...LEVELS),
        (draw, endurance, extra, level) => {
          const result = vehicleCheck(
            {
              vehicle: { id: 'car', plate: 'P-1' },
              passengers: [],
              concealment: [
                {
                  id: 'rider',
                  difficulty: 1,
                  endurance,
                  ticksConcealed: endurance + extra,
                  composure: 1,
                  kind: 'passenger',
                  reachedBy: [level],
                },
              ],
              kind: kindFor(level, 0),
              papersValid: true,
              onWatch: false,
              suspicion: 0,
            },
            draw,
          );
          expect(result.found).toContain('rider');
          expect(result.outcome).toBe('vehicle-seized');
        },
      ),
      { numRuns: 100 },
    );
  });

  it('derives composure from tags and stops a full spot', () => {
    expect(composureFor(['calm'], 1, [{ tags: ['calm'], composure: 0.8 }])).toBeCloseTo(0.8);
    expect(composureFor(['nervous'], 0, [{ tags: ['nervous'], composure: 0.3 }])).toBeCloseTo(0.15);
    expect(composureFor(['clerk'], 0.4, [{ tags: ['calm'], composure: 0.8 }])).toBeCloseTo(0.4);
    const spot = { id: 'boot', capacity: 1, difficulty: 0.4, endurance: 10 };
    const first = board({ rides: [], seats: 2, mode: 'concealed', npc: 'npc:a', spot });
    if (typeof first === 'string') throw new Error(first);
    expect(board({ rides: first, seats: 2, mode: 'concealed', npc: 'npc:b', spot })).toBe('that spot is full');
    expect(board({ rides: [], seats: 1, mode: 'declared', npc: 'npc:a' })).toBe('no seat free');
    const quiet: PassengerView = { npc: 'npc:a', mode: 'concealed', spot: 'boot', crossed: false };
    const held = syncConcealment({
      nextRides: [quiet],
      records: [],
      spots: [spot],
      added: 11,
      composureForNpc: () => 0.6,
    });
    expect(held.facts).toEqual([STRAIN_LINE]);
    expect(held.records[0]?.strained).toBe(true);
    expect(held.records[0]?.composure).toBe(0);
    expect(isSmuggleMet([{ npc: 'npc:a', loc: 'loc:gate' }], 'npc:a', 'loc:gate')).toBe(true);
    const runtime = runtimeFromScenario({ streetOps: { enabled: true } });
    expect(streetOpsAddOn(runtime).objectives.map((item) => item.kind)).toEqual(['smuggle']);
    expect([...DIRECTIVE_OBJECTIVE_KINDS]).toEqual(['identify', 'recruit', 'arrest', 'intercept']);
  });
});

function loadCore(): { content: ContentSet; inputs: Omit<GenerateInputs, 'scenario' | 'preset'> } {
  const content = loadContent([CORE_DIR], ['core']);
  if (!content.ok) throw new Error('core pack failed to load');
  const cityData = loadCityData(CORE_DIR);
  if (!cityData.ok) throw new Error('city.yaml failed to load');
  const descriptors = loadDescriptorData(CORE_DIR);
  if (!descriptors.ok) throw new Error('descriptors.yaml failed to load');
  const publicTexts = loadPublicTexts(CORE_DIR);
  if (!publicTexts.ok) throw new Error('public texts failed to load');
  return {
    content: content.value,
    inputs: {
      content: content.value,
      cityData: cityData.value,
      descriptors: descriptors.value,
      publicTexts: publicTexts.value,
    },
  };
}

const LOADED = loadCore();

function preset(): DifficultyPreset {
  for (const [key, value] of LOADED.content.difficultyPresets) {
    if (key === 'standard' || key.endsWith('/standard')) return value;
  }
  throw new Error('no standard preset');
}

function scenario(): ScenarioConfig {
  return ScenarioConfigSchema.parse({
    difficulty: { preset: 'standard' },
    mole: false,
    recruitment: {
      pitch: { w1: 1, w2: 1, w3: 1, w4: 1 },
      firstContact: { a: 1, b: 1, c: 1, d: 1 },
      meeting: { trust: 1, riskAversion: 1, scheduleConflict: 1, agendaInterest: 1 },
      exposure: { k1: 1, k2: 1, k3: 1 },
      turn: { w1: 1, w2: 1, w3: 1, w4: 1, w5: 1 },
    },
    streetOps: { enabled: true, ticksPerPhase: 360 },
  });
}

function withRider(world: WorldState): { world: WorldState; npc: NpcId } {
  const npc = Object.keys(world.npcs)[0] as NpcId;
  const person = world.npcs[npc];
  if (person === undefined) throw new Error('no npc');
  const phases: readonly Phase[] = [0, 1, 2, 3];
  const entries = [0, 1, 2, 3, 4, 5, 6].flatMap((weekday) => phases.map((phase) => ({ weekday, phase, loc: world.player.loc })));
  return {
    npc,
    world: {
      ...world,
      npcs: { ...world.npcs, [npc]: { ...person, schedule: { entries } } },
      relationships: {
        ...world.relationships,
        [npc]: { ...(world.relationships[npc] ?? newRelationship(npc)), recruited: true, trust: 0.9, exposure: 0 },
      },
    },
  };
}

describe('passenger actions', () => {
  it('hides a willing passenger, strains them, and records a delivery after a checkpoint', () => {
    const enabled = scenario();
    const generated = generate('street-ops-passenger', { ...LOADED.inputs, preset: preset(), scenario: enabled });
    const { world, npc } = withRider(generated);
    const file = gridGraph(2, 2);
    const segment = file.segments[0]?.id;
    if (segment === undefined) throw new Error('grid has no segment');
    const graph = compileStreetGraph({
      ...file,
      frontages: [{ location: world.player.loc, segment, at: 0.2, side: 'right' }],
      checkpoints: [{ id: 'halt', kind: 'document-halt', segment, at: 0.5 }],
    });
    const post = CheckpointKindSchema.parse({
      id: 'document-halt',
      borderCheck: 'pass',
      thoroughness: 0.2,
      hours: ['morning', 'afternoon', 'evening', 'night'],
      searches: ['visual'],
    });
    const runtime = runtimeFromScenario(enabled, {
      graphs: [graph],
      checkpoints: [post],
      passengerTrustMin: 0.5,
      composureRows: [{ tags: ['calm'], composure: 0.8 }],
      vehicles: [
        {
          id: 'pool-coupe',
          name: 'Pool coupe',
          era: { from: world.meta.setting.year, to: world.meta.setting.year },
          speed: 'normal',
          seats: 2,
          conspicuousness: 0.4,
          spots: [{ id: 'boot', capacity: 1, search: 0.4, endurance: 1, reachedBy: ['undercarriage'] }],
        },
      ],
    });
    const store = TruthStore.create({ get: () => undefined });
    const ctx: ResolverContext = { content: LOADED.content, extensions: streetOpsRegistry(enabled, runtime), truth: store };
    const begun = resolve(world, { kind: 'street-ops.drive', vehicle: 'pool-coupe' }, createPrng('board'), ctx);
    const offered = driveCandidates(begun.next, ctx).filter((action) => action.npc === npc);
    expect(offered).toEqual([
      { kind: 'street-ops.pickup', npc, mode: 'declared' },
      { kind: 'street-ops.pickup', npc, mode: 'concealed', spot: 'boot' },
    ]);
    expect(quote(begun.next, { kind: 'street-ops.pickup', npc, mode: 'concealed', spot: 'boot' }, ctx).allowed).toBe(true);
    const boarded = resolve(begun.next, { kind: 'street-ops.pickup', npc, mode: 'concealed', spot: 'boot' }, createPrng('board'), ctx);
    expect(boarded.next.ext?.streetOps?.session?.passengers).toEqual([npc]);
    expect(boarded.result.factLines.join(' ')).not.toContain(STRAIN_LINE);
    const looked = resolve(boarded.next, { kind: 'street-ops.look', mode: 'look-around' }, createPrng('board'), ctx);
    expect(looked.result.factLines).toContain(STRAIN_LINE);
    expect(store.streetOps()?.concealment['pool-coupe']?.[0]?.strained).toBe(true);
    const crossed = resolve(looked.next, { kind: 'street-ops.turn', relative: 'straight' }, createPrng('board'), ctx);
    expect(crossed.next.ext?.streetOps?.rides['pool-coupe']?.[0]?.crossed).toBe(true);
    expect(crossed.next.relationships[npc]?.exposure ?? 0).toBe(0);
    const dropped = resolve(crossed.next, { kind: 'street-ops.dropoff', npc, loc: world.player.loc }, createPrng('board'), ctx);
    expect(dropped.next.ext?.streetOps?.deliveries).toEqual([{ npc, loc: world.player.loc, at: world.time }]);
    expect(isSmuggleMet(dropped.next.ext?.streetOps?.deliveries ?? [], npc, world.player.loc)).toBe(true);
  });
});
