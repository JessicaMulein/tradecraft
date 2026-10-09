/**
 * Property 14 — regional save, replay and outcome (multi-city task 12.3).
 */

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { ContentSet, DifficultyPreset } from '@tradecraft/content';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  ScenarioConfigSchema,
  type ScenarioConfig,
} from '@tradecraft/engine';
import {
  buildOutcomeRecord,
  createPrng,
  generateRegion,
  loadRegionContent,
  parseOutcomeRecord,
  regionCatalog,
  regionSources,
  resolve,
  TruthStore,
  type GenerateRegionInputs,
  type WorldState,
} from '@tradecraft/engine';

import { ActionLog, ExtractionQueue } from '../api/turn-pipeline.js';
import { CaseFile } from '../casefile/casefile.js';
import { Journal } from '../journal/journal.js';
import { NotificationStore } from '../notify/store.js';
import { loadSnapshot, saveSnapshot, type SaveSources } from './save.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const PACKS = join(HERE, '..', '..', '..', '..', 'content', 'packs');
const FIXTURES = join(HERE, '..', '..', '..', '..', 'engine', 'src', 'lib', 'region', 'fixtures');

const FIXTURE_DIRS = [
  join(PACKS, 'core'),
  join(PACKS, 'era-cold-war-early'),
  join(PACKS, 'lib-central-europe'),
  join(FIXTURES, 'fixture-north'),
  join(FIXTURES, 'fixture-east'),
  join(FIXTURES, 'fixture-south'),
  join(FIXTURES, 'fixture-west'),
  join(FIXTURES, 'region-fixture'),
];

function show(errors: readonly { pack: string; file: string; path: string; message: string }[]): string {
  return errors.map((error) => `${error.pack}/${error.file}:${error.path} ${error.message}`).join('\n');
}

function loaded(): { content: ContentSet; catalog: ReturnType<typeof regionCatalog> } {
  const result = loadRegionContent(FIXTURE_DIRS, ['region-fixture']);
  if (!result.ok) {
    throw new Error(show(result.errors));
  }
  const ids = new Set(result.value.manifest.packs.map((pack) => pack.id));
  const sources = regionSources(FIXTURE_DIRS, ids);
  return { content: result.value, catalog: regionCatalog(sources.sources) };
}

const { content, catalog } = loaded();

function preset(id: string): DifficultyPreset {
  for (const [key, value] of content.difficultyPresets) {
    if (key === id || key.endsWith(`/${id}`)) {
      return value;
    }
  }
  throw new Error(`no difficulty preset ${id}`);
}

function regional(id: string) {
  for (const value of catalog.presets.values()) {
    if (value.preset === id) {
      return value;
    }
  }
  throw new Error(`no regional preset ${id}`);
}

function scenario(template: string): ScenarioConfig {
  return ScenarioConfigSchema.parse({
    difficulty: { preset: 'standard' },
    mole: false,
    region: { template, stationModel: 'regional' },
    recruitment: {
      pitch: { w1: 1, w2: 1, w3: 1, w4: 1 },
      firstContact: { a: 1, b: 1, c: 1, d: 1 },
      meeting: { trust: 1, riskAversion: 1, scheduleConflict: 1, agendaInterest: 1 },
      exposure: { k1: 1, k2: 1, k3: 1 },
      turn: { w1: 1, w2: 1, w3: 1, w4: 1, w5: 1 },
    },
  });
}

const TEMPLATE = [...catalog.templates.keys()][0] ?? 'central-1953';

function inputs(seed: string): GenerateRegionInputs {
  return {
    seed,
    content,
    catalog,
    preset: preset('standard'),
    regionalPreset: regional('standard'),
    scenario: scenario(TEMPLATE),
  };
}

function sources(world: WorldState): SaveSources {
  return {
    world,
    journal: new Journal(),
    notifications: new NotificationStore(),
    flavourCache: {},
    actionLog: new ActionLog(),
    extractionQueue: new ExtractionQueue(),
    caseFile: new CaseFile(),
    truth: { facts: [], allegiances: new Map(), identities: new Map(), claimTruths: [] },
    viewState: { hintsSeen: [], observedCoverState: {} },
    pipeline: { turnCounter: 0, outcomeWritten: false },
    savedAt: '1953-06-01T00:00:00.000Z',
  };
}

function play(seed: string, waits: number): WorldState {
  let world = generateRegion(inputs(seed));
  const rng = createPrng(world.rng);
  for (let step = 0; step < waits; step += 1) {
    const resolved = resolve(world, { kind: 'wait', phases: 1 }, rng, { content });
    world = { ...resolved.next, rng: rng.state() };
    const city = world.region?.order[0];
    const streams = world.cityStreams;
    if (city !== undefined && streams !== undefined) {
      const spine = createPrng(streams.spine[city]);
      spine.next();
      world = {
        ...world,
        cityStreams: {
          spine: { ...streams.spine, [city]: spine.state() },
          ambient: streams.ambient,
        },
      };
    }
  }
  return world;
}

describe('Property 14: regional save, replay and outcome', () => {
  it('restores a regional save, replays the seed, and records the region', () => {
    // Feature: multi-city, Property 14: Regional save, replay and outcome
    const truth = TruthStore.create({ get: () => undefined });
    fc.assert(
      fc.property(
        fc.constantFrom('alpha', 'bravo', 'charlie', 'delta'),
        fc.integer({ min: 0, max: 2 }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        (seed, waits, suspicion) => {
          const played = play(seed, waits);
          const again = play(seed, waits);
          expect(again).toEqual(played);
          expect(again.cityStreams).toEqual(played.cityStreams);

          const serviceId = Object.keys(played.services ?? {})[0];
          const handoffId = Object.keys(played.handoffs ?? {})[0];
          const city = played.region?.order[0];
          const varied: WorldState = {
            ...played,
            player: { ...played.player, png: ['Eastland'] },
            services: played.services === undefined || serviceId === undefined
              ? played.services
              : {
                  ...played.services,
                  [serviceId]: {
                    ...played.services[serviceId],
                    beliefs: { ...played.services[serviceId].beliefs, coverSuspicion: suspicion },
                  },
                },
            handoffs: played.handoffs === undefined || handoffId === undefined
              ? played.handoffs
              : {
                  ...played.handoffs,
                  [handoffId]: { ...played.handoffs[handoffId], status: 'in-transit' },
                },
            transits: {
              ...(played.transits ?? {}),
              'transit:extra': {
                id: 'transit:extra',
                route: 'route:extra',
                travellers: ['player'],
                status: 'running',
              },
            },
            ended: { outcome: 'success', at: played.time, cause: 'leader-arrested' },
          };
          const snapshot = JSON.parse(JSON.stringify(saveSnapshot(sources(varied))));
          expect(snapshot.version).toBe(4);
          const loaded = loadSnapshot(snapshot, played.meta.content);
          expect(loaded.ok).toBe(true);
          if (!loaded.ok) {
            return;
          }
          expect(loaded.session.world).toEqual(snapshot.world);
          expect(loaded.session.world.cityStreams).toEqual(varied.cityStreams);
          expect(loaded.session.world.region?.cities).toEqual(varied.region?.cities);
          expect(loaded.session.world.transits).toEqual(varied.transits);
          expect(loaded.session.world.handoffs?.[handoffId as keyof typeof varied.handoffs]?.status).toBe('in-transit');
          expect(loaded.session.world.services?.[serviceId as keyof NonNullable<WorldState['services']>]).toBeDefined();

          const record = buildOutcomeRecord(varied, truth);
          expect(parseOutcomeRecord(JSON.parse(JSON.stringify(record)))).toEqual(record);
          expect(record.schema).toBe(2);
          expect(record.region?.template).toBe(varied.region?.template);
          expect(record.region?.cities.map((row) => row.id)).toEqual(varied.region?.order);
          expect(record.region?.png).toEqual(['Eastland']);
          if (serviceId !== undefined && city !== undefined) {
            expect(record.region?.coverSuspicion.find((row) => row.service === serviceId)?.coverSuspicion).toBe(suspicion);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
