/**
 * Regional bench (multi-city task 14.2; Requirements 19.1–19.6).
 *
 * Measures the fixture four-city region. Reference-machine budgets stay as
 * written in Req 19. CI multiplies them by {@link benchFactor}.
 */

import { join } from 'node:path';

import type { ContentSet, DifficultyPreset, Namer } from '@tradecraft/content';
import {
  DEFAULT_TOKEN_BUDGET,
  buildNarratorPrompt,
  buildPrompt,
  estimateTokens,
} from '@tradecraft/dialogue';
import {
  advanceRegion,
  arrive,
  assignTiers,
  createPrng,
  generateRegion,
  initialRegionClock,
  loadRegionContent,
  quoteDepart,
  referenceCity,
  referenceSimulator,
  referenceSpine,
  regionCatalog,
  regionSources,
  resolveDepart,
  ScenarioConfigSchema,
  setRegionMetricsSink,
  type GameTime,
  type IRouteId,
  type RegionCatalog,
  type RegionTimingPurpose,
  type RegionTimingRecord,
  type TravelDocId,
  type WorldState,
} from '@tradecraft/engine';

import { METRIC_ROLES } from '../metrics/index.js';

/** City ids on a regional world. The package barrel's `CityId` is the content-city id, which is a plain string. */
type RegionCityId = NonNullable<WorldState['region']>['order'][number];

/** Req 19 budgets on the reference machine, before the CI machine factor. */
export const REGION_BUDGETS = {
  generateMs: 8_000,
  coarseMedianMs: 5,
  coarseP99Ms: 20,
  reconcileMs: 300,
  travelMs: 1_000,
  heapBytes: 1_000_000_000,
  saveBytes: 15 * 1024 * 1024,
} as const;

const PACKS = join(import.meta.dirname, '../../../../content/packs');
const FIXTURES = join(import.meta.dirname, '../../../../engine/src/lib/region/fixtures');

const COARSE_SAMPLES = 40;
const RECONCILE_SAMPLES = 11;
const PHASES_PER_DAY = 4;
const SAVE_DAYS = 30;
const TRAVEL_PHASES = 8;

/**
 * CI runners are slower than the reference machine. `TRADECRAFT_BENCH_FACTOR`
 * overrides the scale. Otherwise CI uses 8 and a local run uses 1.
 */
export function benchFactor(): number {
  const raw = process.env.TRADECRAFT_BENCH_FACTOR;
  if (raw !== undefined && raw.length > 0) {
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }
  if (process.env.CI === 'true') {
    return 8;
  }
  return 1;
}

export function percentile(samples: readonly number[], p: number): number {
  const sorted = [...samples].sort((a, b) => a - b);
  const first = sorted[0];
  if (first === undefined) {
    throw new Error('percentile needs at least one sample');
  }
  const rank = Math.ceil((p / 100) * sorted.length);
  const index = Math.min(sorted.length, Math.max(1, rank)) - 1;
  return sorted[index] ?? first;
}

export interface RegionBenchReport {
  readonly generateMs: number;
  readonly coarseMedianMs: number;
  readonly coarseP99Ms: number;
  readonly reconcileMs: number;
  readonly travelMs: number;
  readonly travelPhases: number;
  readonly heapBytes: number;
  readonly saveBytes: number;
  readonly narratorTokens: number;
  readonly npcTokens: number;
  readonly tokenBudget: number;
  readonly roles: readonly string[];
  readonly purposes: readonly RegionTimingPurpose[];
}

export function measureFixtureBench(): RegionBenchReport {
  const records: RegionTimingRecord[] = [];
  setRegionMetricsSink({ append: (record) => records.push(record) });
  try {
    const { content, catalog, template } = loadFixture();
    const started = performance.now();
    const world = generateRegion({
      seed: 'region-bench',
      content,
      catalog,
      preset: difficulty(content, 'standard'),
      regionalPreset: standardPreset(catalog),
      scenario: scenario(template),
    });
    const generateMs = performance.now() - started;
    const coarse = measureCoarse();
    const reconcileMs = measureReconcile(world);
    const travel = measureTravel(world);
    const saveBytes = measureSave(world);
    const prompts = measurePrompts(content, world);
    return {
      generateMs,
      coarseMedianMs: percentile(coarse, 50),
      coarseP99Ms: percentile(coarse, 99),
      reconcileMs,
      travelMs: travel.ms,
      travelPhases: travel.phases,
      heapBytes: process.memoryUsage().heapUsed,
      saveBytes,
      narratorTokens: prompts.narrator,
      npcTokens: prompts.npc,
      tokenBudget: DEFAULT_TOKEN_BUDGET,
      roles: [...METRIC_ROLES],
      purposes: records.map((record) => record.purpose),
    };
  } finally {
    setRegionMetricsSink(undefined);
  }
}

function loadFixture(): { content: ContentSet; catalog: RegionCatalog; template: string } {
  const dirs = [
    join(PACKS, 'core'),
    join(PACKS, 'era-cold-war-early'),
    join(PACKS, 'lib-central-europe'),
    join(FIXTURES, 'fixture-north'),
    join(FIXTURES, 'fixture-east'),
    join(FIXTURES, 'fixture-south'),
    join(FIXTURES, 'fixture-west'),
    join(FIXTURES, 'region-fixture'),
  ];
  const result = loadRegionContent(dirs, ['region-fixture']);
  if (!result.ok) {
    throw new Error(result.errors.map((error) => error.message).join('\n'));
  }
  const ids = new Set(result.value.manifest.packs.map((pack) => pack.id));
  const catalog = regionCatalog(regionSources(dirs, ids).sources);
  const template = [...catalog.templates.keys()][0];
  if (template === undefined) {
    throw new Error('fixture has no region template');
  }
  return { content: result.value, catalog, template };
}

function difficulty(content: ContentSet, id: string): DifficultyPreset {
  for (const [key, value] of content.difficultyPresets) {
    if (key === id || key.endsWith(`/${id}`)) {
      return value;
    }
  }
  throw new Error(`no difficulty preset ${id}`);
}

function standardPreset(catalog: RegionCatalog) {
  for (const value of catalog.presets.values()) {
    if (value.preset === 'standard') {
      return value;
    }
  }
  throw new Error('no standard regional preset');
}

function scenario(template: string) {
  return ScenarioConfigSchema.parse({
    difficulty: { preset: 'standard' },
    mole: false,
    region: { template },
    recruitment: {
      pitch: { w1: 1, w2: 1, w3: 1, w4: 1 },
      firstContact: { a: 1, b: 1, c: 1, d: 1 },
      meeting: { trust: 1, riskAversion: 1, scheduleConflict: 1, agendaInterest: 1 },
      exposure: { k1: 1, k2: 1, k3: 1 },
      turn: { w1: 1, w2: 1, w3: 1, w4: 1, w5: 1 },
    },
  });
}

function measureCoarse(): number[] {
  const city = 'city:bench';
  const simulator = referenceSimulator();
  const spine = referenceSpine(city);
  const rng = createPrng('bench-coarse');
  let ambient = referenceCity(city);
  for (let warm = 0; warm < 8; warm += 1) {
    ambient = simulator.advanceCoarse(city, ambient, spine, rng).next;
  }
  const samples: number[] = [];
  for (let sample = 0; sample < COARSE_SAMPLES; sample += 1) {
    const started = performance.now();
    ambient = simulator.advanceCoarse(city, ambient, spine, rng).next;
    samples.push(performance.now() - started);
  }
  return samples;
}

function measureReconcile(world: WorldState): number {
  const clock = clockOf(world);
  const city = clock.order[0];
  if (city === undefined) {
    throw new Error('region has no city to reconcile');
  }
  const simulator = referenceSimulator();
  const metrics = world.meta.scenario.metrics;
  const samples: number[] = [];
  let current = clock;
  for (let sample = 0; sample < RECONCILE_SAMPLES; sample += 1) {
    const started = performance.now();
    current = arrive(current, city, [], simulator, { metrics, debug: false });
    samples.push(performance.now() - started);
  }
  return percentile(samples, 50);
}

function measureTravel(world: WorldState): { ms: number; phases: number } {
  const region = world.region;
  if (region === undefined) {
    throw new Error('expected a region');
  }
  const route = Object.values(region.intercity).find((item) => item.duration === TRAVEL_PHASES);
  if (route === undefined || route.fromCity === undefined) {
    throw new Error('fixture has no 8-phase route');
  }
  const at = { day: world.time.day, phase: timetablePhase(route.timetable) };
  let placed: WorldState = {
    ...world,
    time: at,
    player: { ...world.player, loc: route.from, city: route.fromCity },
    locationOf: {
      ...(world.locationOf ?? {}),
      player: { city: route.fromCity, loc: route.from },
    },
  };
  placed = clearWeather(placed, route.fromCity, route.cancellingWeather ?? []);
  placed = withRequiredPapers(placed, route.id, at);
  const action = {
    kind: 'depart' as const,
    route: route.id,
    at,
    papers: placed.player.papers ?? [],
  };
  const quoted = quoteDepart(placed, action);
  if (!quoted.allowed || quoted.phases !== TRAVEL_PHASES) {
    throw new Error(quoted.reason ?? `departure quoted ${quoted.phases} phases`);
  }
  const simulator = referenceSimulator();
  const metrics = placed.meta.scenario.metrics;
  let clock = clockOf(placed);
  const started = performance.now();
  for (let phase = 0; phase < TRAVEL_PHASES; phase += 1) {
    clock = advanceRegion(clock, simulator, {
      tiers: assignTiers(clock.order, null),
      metrics,
      debug: false,
    });
  }
  resolveDepart(placed, action, createPrng('bench-travel'));
  return { ms: performance.now() - started, phases: quoted.phases };
}

function measureSave(world: WorldState): number {
  let clock = clockOf(world);
  const simulator = referenceSimulator();
  const steps = SAVE_DAYS * PHASES_PER_DAY;
  for (let step = 0; step < steps; step += 1) {
    clock = advanceRegion(clock, simulator, {
      tiers: assignTiers(clock.order, null),
      debug: false,
    });
  }
  const payload = JSON.stringify({ world, time: clock.time, ambient: clock.ambient });
  return Buffer.byteLength(payload);
}

function measurePrompts(content: ContentSet, world: WorldState): { narrator: number; npc: number } {
  const region = world.region;
  const cityId = world.player.city;
  let city: { name?: string; styleSheet?: string; weather: { condition: string } } | undefined;
  if (region !== undefined && cityId !== undefined && cityId !== null) {
    city = region.cities[cityId];
  }
  const name = city?.name ?? 'the city';
  const narrator = buildNarratorPrompt({
    scene: {
      location: {
        name: 'Halt',
        description: 'The station halt.',
        atmosphere: ['soot'],
      },
      time: world.time,
      weather: city?.weather.condition ?? 'clear',
      crowd: 'sparse',
      visible: [],
      kind: 'arrival',
      city: { name, styleSheet: city?.styleSheet },
    },
    factLines: [`You are in ${name}.`],
  });
  const namer: Namer = (value: unknown) => (typeof value === 'string' ? value : 'someone');
  const npc = buildPrompt({
    predicates: content.predicates,
    namer,
    persona: {
      name: 'Clerk',
      background: `A booking clerk in ${name}.`,
      voiceTraits: ['quiet'],
      mannerisms: ['checks the timetable'],
    },
    knowledge: { known: [], falseBeliefs: [], knownEntities: [] },
    toldList: [],
    recentTurns: [{ speaker: 'npc', text: `The carriage in ${name} is on the board.` }],
    playerLine: 'When does it leave?',
  });
  return {
    narrator: estimateTokens(narrator.text),
    npc: npc.tokens,
  };
}

function clockOf(world: WorldState) {
  const region = world.region;
  const streams = world.cityStreams;
  if (region === undefined || streams === undefined) {
    throw new Error('bench world has no region clock');
  }
  const ambient: Record<RegionCityId, ReturnType<typeof referenceCity>> = {};
  for (const city of region.order) {
    ambient[city] = referenceCity(city);
  }
  return initialRegionClock({
    seed: world.meta.seed,
    order: region.order,
    playerCity: world.player.city ?? null,
    ambient,
    spine: streams.spine,
    ambientStreams: streams.ambient,
    time: world.time,
  });
}

function timetablePhase(timetable: string | undefined): 0 | 1 | 2 | 3 {
  if (timetable === 'evening') {
    return 2;
  }
  if (timetable === 'night') {
    return 3;
  }
  if (timetable === 'midday' || timetable === 'afternoon') {
    return 1;
  }
  return 0;
}

function clearWeather(
  state: WorldState,
  city: RegionCityId,
  cancelling: readonly string[],
): WorldState {
  const region = state.region;
  if (region === undefined) {
    return state;
  }
  const origin = region.cities[city];
  if (origin === undefined || !cancelling.includes(origin.weather.condition)) {
    return state;
  }
  return {
    ...state,
    region: {
      ...region,
      cities: {
        ...region.cities,
        [city]: { ...origin, weather: { ...origin.weather, condition: 'clear' } },
      },
    },
  };
}

function withRequiredPapers(state: WorldState, route: IRouteId, at: GameTime): WorldState {
  let current = state;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const quoted = quoteDepart(current, {
      kind: 'depart',
      route,
      at,
      papers: current.player.papers ?? [],
    });
    if (quoted.allowed) {
      return current;
    }
    const reason = quoted.reason ?? '';
    if (!reason.startsWith('missing papers: ')) {
      return current;
    }
    const kind = reason.slice('missing papers: '.length).split(', ')[0];
    if (kind === undefined || kind.length === 0) {
      return current;
    }
    current = addPaper(current, kind);
  }
  return current;
}

function addPaper(state: WorldState, kind: string): WorldState {
  const docs = state.travelDocs ?? {};
  const template = Object.values(docs)[0];
  if (template === undefined) {
    throw new Error('the player has no paper to copy');
  }
  const id = `paper:bench-${kind}` as TravelDocId;
  return {
    ...state,
    travelDocs: {
      ...docs,
      [id]: { ...template, id, kind, holder: 'player' },
    },
    player: { ...state.player, papers: [...(state.player.papers ?? []), id] },
  };
}
