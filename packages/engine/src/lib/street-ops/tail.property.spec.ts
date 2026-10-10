/**
 * Properties 6 and 7 (street-ops task 7). An observation names a vehicle that
 * was on that segment. A world with a tail and a world without one offer the
 * same actions when the player has seen the same things.
 *
 * **Validates: Requirements 6.1, 6.2, 6.4, 6.5, 12.3**
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
import { ScenarioConfigSchema } from '../config/scenario-config.js';
import { generate, type GenerateInputs } from '../generate.js';
import { asTruth, revealTruth } from '../model/core.js';
import type { WorldState } from '../model/state.js';
import { createPrng } from '../prng/prng.js';
import { TruthDraft } from '../truth/truth-draft.js';
import { TruthStore } from '../truth/truth.js';
import { streetOpsRegistry } from './addon.js';
import { driveCandidates, runtimeFromScenario } from './drive.js';
import { compileStreetGraph, gridGraph } from './graph.js';
import { containsInOrder, featuresAt, summariseObservations } from './maneuver.js';
import { emptyStreetOpsState, emptyStreetOpsTruth, type TailTeam } from './state.js';
import { streetReplayHeader } from './stream.js';
import {
  classifyHold,
  escalation,
  holdChance,
  stepStreet,
  tailedFlag,
  teamCondition,
  type StreetStepInput,
} from './tail.js';

const GRAPH = compileStreetGraph(gridGraph(2, 2, 0));
const SEGMENT = 'v-0-0';

const CORE_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', 'content', 'packs', 'core');

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

function stepInput(seed: string, discipline: number, team: number, traffic: number, wanted: boolean): StreetStepInput {
  return {
    seed,
    year: 1950,
    sessionKey: 'session',
    step: 1,
    phases: 0,
    path: [{ segment: SEGMENT, dir: 'fwd', progress: 1 }],
    here: SEGMENT,
    street: 'file-0',
    phase: 'morning',
    traffic,
    attention: 1,
    wanted,
    truth: emptyStreetOpsTruth(),
    profiles: [
      { id: 'foreign-box', service: 'service', discipline, team, methods: ['car-follow'] },
    ],
    methods: [{ id: 'car-follow', era: { from: 1946, to: 1955 } }],
    graph: GRAPH,
    sightRangeM: 250,
    noticeBase: 0.9,
    regularRate: 0.5,
    lostTimeoutPhases: 2,
    arrivalRisk: 0,
    beforePath: [],
    routes: [],
    noted: [],
  };
}

describe('tails and spotting', () => {
  it('records an observation only for a vehicle that was on that segment', () => {
    // Feature: street-ops, Property 6: Observations are true
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 12 }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.integer({ min: 1, max: 4 }),
        fc.integer({ min: 0, max: 3 }),
        fc.boolean(),
        (seed, discipline, team, traffic, wanted) => {
          const result = stepStreet(stepInput(seed, discipline, team, traffic, wanted));
          for (const observation of result.observations) {
            const found = result.present.find(
              (vehicle) => vehicle.id === observation.vehicleId && vehicle.segment === observation.segment,
            );
            expect(found?.descriptor).toBe(observation.descriptor);
            expect(observation.line.toLowerCase()).not.toContain('tail');
          }
          expect(result.lines.join(' ').toLowerCase()).not.toContain('you are being followed');
        },
      ),
      { numRuns: 100 },
    );
  });

  it('offers the same street actions whether or not a tail is attached', () => {
    // Feature: street-ops, Property 7: No oracle for the tail
    const enabled = ScenarioConfigSchema.parse({
      difficulty: { preset: 'standard' },
      mole: false,
      recruitment: {
        pitch: { w1: 1, w2: 1, w3: 1, w4: 1 },
        firstContact: { a: 1, b: 1, c: 1, d: 1 },
        meeting: { trust: 1, riskAversion: 1, scheduleConflict: 1, agendaInterest: 1 },
        exposure: { k1: 1, k2: 1, k3: 1 },
        turn: { w1: 1, w2: 1, w3: 1, w4: 1, w5: 1 },
      },
      streetOps: { enabled: true },
    });
    const runtime = runtimeFromScenario(enabled, {
      graphs: [GRAPH],
      maneuvers: [
        { id: 'cut-one-way', era: { from: 1946, to: 1955 }, requires: ['one-way'], quality: 0.6, ticks: 3, suspicion: 0.3 },
      ],
      tails: [{ id: 'foreign-box', service: 'service', discipline: 0.7, team: 2, methods: ['car-follow'] }],
      methods: [{ id: 'car-follow', era: { from: 1946, to: 1955 } }],
    });
    const extensions = streetOpsRegistry(enabled, runtime);
    const session = {
      ...emptyStreetOpsState(streetReplayHeader()),
      session: {
        sessionKey: 'session',
        vehicle: 'pool',
        at: { segment: SEGMENT, dir: 'fwd' as const, progress: 1 },
        speed: 'normal' as const,
        ticks: 0,
        phasesCharged: 0,
        path: [{ segment: SEGMENT, dir: 'fwd' as const, progress: 1 }],
        passengers: [],
      },
    };
    const world = (tailed: boolean): WorldState =>
      ({
        player: { loc: 'hub', tailed: asTruth(tailed) },
        time: { day: 1, phase: 0 },
        meta: { setting: { year: 1950 }, seed: 'oracle' },
        ext: { streetOps: session },
      }) as unknown as WorldState;
    const ctx = { extensions } as ResolverContext;
    fc.assert(
      fc.property(fc.boolean(), fc.boolean(), (left, right) => {
        expect(driveCandidates(world(left), ctx)).toEqual(driveCandidates(world(right), ctx));
      }),
      { numRuns: 100 },
    );
    const offered = driveCandidates(world(true), ctx).map((action) => action.kind);
    expect(offered).toContain('street-ops.maneuver');
    expect(JSON.stringify(offered).toLowerCase()).not.toContain('tail');
  });

  it('loses a team without raising suspicion when the maneuver is quiet, and searches when it is burned', () => {
    expect(holdChance({ discipline: 0, quality: 1, vehicles: 1, traffic: 1 })).toBe(0);
    expect(classifyHold(0, 0.2, false, false)).toBe('lost');
    expect(classifyHold(0, 0.2, true, true)).toBe('handed-off');
    expect(classifyHold(0, 0.8, false, true)).toBe('burned');
    expect(classifyHold(1, 0.99, false, true)).toBe('attached');
    expect(escalation('lost', false, 0.4)).toEqual({ coverSuspicionDelta: 0, alert: false, search: false });
    expect(escalation('lost', true, 0.4).alert).toBe(true);
    expect(escalation('burned', true, 0.8).search).toBe(true);
    const attached: TailTeam = {
      id: 'box',
      service: 'service',
      profile: 'foreign-box',
      status: 'attached',
      since: 0,
      lostFor: 0,
      obvious: false,
      vehicles: [],
    };
    expect(tailedFlag({ box: attached })).toBe(true);
    expect(teamCondition({ ...attached, status: 'lost', lostFor: 0 }, 2)).toBe('lost-briefly');
    expect(teamCondition({ ...attached, status: 'lost', lostFor: 2 }, 2)).toBe('lost');
    expect(featuresAt(GRAPH, SEGMENT)).toContain('one-way');
    expect(containsInOrder(['a', 'b', 'c'], ['a', 'c'])).toBe(true);
    expect(summariseObservations([]).toLowerCase()).not.toContain('tail');
  });

  it('stages a tail on the truth draft and writes it only when the turn commits', () => {
    const store = TruthStore.create({ get: () => undefined });
    const team: TailTeam = {
      id: 'box',
      service: 'service',
      profile: 'foreign-box',
      status: 'attached',
      since: 0,
      lostFor: 0,
      obvious: false,
      vehicles: [],
    };
    const next = { ...emptyStreetOpsTruth(), teams: { box: team } };
    const discarded = TruthDraft.over(store);
    discarded.replaceStreetOps(next);
    expect(store.streetOps()).toBeUndefined();
    discarded.discard();
    expect(store.streetOps()).toBeUndefined();
    const draft = TruthDraft.over(store);
    draft.replaceStreetOps(next);
    draft.commit();
    expect(store.streetOps()?.teams.box?.status).toBe('attached');
  });

  it('files a team in the truth store when a tailed player drives, and does not say so', () => {
    const enabled = ScenarioConfigSchema.parse({
      difficulty: { preset: 'standard' },
      mole: false,
      recruitment: {
        pitch: { w1: 1, w2: 1, w3: 1, w4: 1 },
        firstContact: { a: 1, b: 1, c: 1, d: 1 },
        meeting: { trust: 1, riskAversion: 1, scheduleConflict: 1, agendaInterest: 1 },
        exposure: { k1: 1, k2: 1, k3: 1 },
        turn: { w1: 1, w2: 1, w3: 1, w4: 1, w5: 1 },
      },
      streetOps: { enabled: true, ticksPerPhase: 1 },
    });
    const world = generate('street-ops-tail', { ...LOADED.inputs, preset: preset(), scenario: enabled });
    const file = gridGraph(2, 2);
    const segment = file.segments[0]?.id;
    if (segment === undefined) throw new Error('grid has no segment');
    const graph = compileStreetGraph({
      ...file,
      frontages: [{ location: world.player.loc, segment, at: 0.2, side: 'right' }],
    });
    const runtime = runtimeFromScenario(enabled, {
      ticksPerPhase: 1,
      graphs: [graph],
      vehicles: [
        {
          id: 'pool-coupe',
          name: 'Pool coupe',
          era: { from: world.meta.setting.year, to: world.meta.setting.year },
          speed: 'normal',
          seats: 2,
          conspicuousness: 0.4,
          spots: [],
        },
      ],
      tails: [{ id: 'foreign-box', service: 'service', discipline: 0.4, team: 2, methods: ['car-follow'] }],
      methods: [{ id: 'car-follow', era: { from: 1946, to: 1955 } }],
    });
    const store = TruthStore.create({ get: () => undefined });
    const ctx: ResolverContext = { content: LOADED.content, extensions: streetOpsRegistry(enabled, runtime), truth: store };
    const tailed: WorldState = { ...world, player: { ...world.player, tailed: asTruth(true) } };
    const action = { kind: 'street-ops.drive' as const, vehicle: 'pool-coupe' };
    expect(quote(tailed, action, ctx).allowed).toBe(true);
    const begun = resolve(tailed, action, createPrng('street-ops-tail'), ctx);
    expect(begun.result.factLines.join(' ').toLowerCase()).not.toContain('tail');
    expect(revealTruth(begun.next.player.tailed)).toBe(true);
    expect(Object.keys(store.streetOps()?.teams ?? {})).toHaveLength(1);
    const quiet = driveCandidates(begun.next, ctx).some((item) => item.kind === 'street-ops.maneuver');
    expect(quiet).toBe(driveCandidates({ ...begun.next, player: { ...begun.next.player, tailed: asTruth(false) } }, ctx).some((item) => item.kind === 'street-ops.maneuver'));
  });
});
