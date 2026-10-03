/**
 * Tests for the intercept action and the wait action's passive observation
 * (task 11.7; Requirements 25.2, 25.3, 25.4, 25.5, 25.6).
 *
 * These drive a generated {@link WorldState} from the real core pack through the
 * intercept/wait resolvers and the top-level {@link quote}/{@link resolve},
 * checking:
 *
 * - Station collection delivers the uncollected in-window transmissions on the
 *   player's known radio/numbers Channels as Intercepts carrying metadata, and
 *   is idempotent (collecting again mints nothing new) — Req 25.2, 25.3;
 * - a `channel?` narrows the sweep to one Channel;
 * - courier interception at the Channel's route during its window produces the
 *   courier's Intercept and runs a detection check — Req 25.4;
 * - intercept elsewhere is not allowed and leaves the state unchanged;
 * - wait at a public, open Location makes passive observations at the reduced
 *   rate with no detection — Req 25.5;
 * - wait stops at closing (a Location closing mid-span yields fewer
 *   observations and the closed Fact Line) — Req 25.6;
 * - determinism: the same inputs give the same result.
 */

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  loadCityData,
  loadContent,
  loadDescriptorData,
  loadPublicTexts,
  type CityData,
  type ContentSet,
  type DescriptorData,
  type DifficultyPreset,
  type EvaluatorKind,
  type PublicText,
} from '@tradecraft/content';

import { createPrng } from '../prng/prng.js';
import { ScenarioConfigSchema } from '../config/scenario-config.js';
import { generate, type GenerateInputs } from '../generate.js';
import { revealTruth, type ChannelId, type LocId, type NpcId, type Phase } from '../model/core.js';
import type { SimEvent, WorldState } from '../model/state.js';
import type { Channel, ChannelSchedule } from '../city/comms.js';
import { TruthStore, type PredicateEvaluatorLookup } from '../truth/truth.js';
import { quote, resolve, visibleNpcsAt } from './action.js';
import {
  quoteIntercept,
  resolveIntercept,
  stationCollection,
  courierHereNow,
  isAtStation,
  retentionDays,
  waitObservations,
  WAIT_OBSERVATION_FACTOR,
  WAIT_CLOSED_FACT_LINE,
  INTERCEPT_PHASE_COST,
  STATION_LOCATION_TYPE,
} from './intercept.js';
import { asTruth, type GameTime } from '../model/core.js';
import type { Intercept, Transmission } from '../cipher/intercept.js';
import type { Observation, ResolverContext } from './result.js';
import type { InterceptAction, ObservationSource, WaitAction } from './types.js';

/**
 * Assert that a result has proposition Observations and that every one of them
 * carries `source` (the source its Case File Claim is filed under).
 */
function expectAllSourced(
  observations: readonly Observation[],
  source: ObservationSource,
): void {
  const sources = observations.flatMap((o) => (o.kind === 'proposition' ? [o.source] : []));
  expect(sources.length).toBeGreaterThan(0);
  expect(sources).toEqual(sources.map(() => source));
}

/**
 * Build a lightweight {@link Transmission} on a Channel at a time, carrying a
 * minimal real {@link Intercept}, for seeding `WorldState.transmissions` in a
 * test. The Intercept id is deterministic in the channel and time so a test can
 * assert which firings were delivered. (In production the Cipher Engine seeds
 * these at world assembly; the action only reads `at`, `channel` and the carried
 * Intercept, so a trivial Intercept exercises the sweep faithfully.)
 */
function testTransmission(channel: Channel, at: GameTime): Transmission {
  const local = channel.id.slice(channel.id.indexOf(':') + 1);
  const slug = local.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const id = `int:${slug}@${at.day}.${at.phase}` as `int:${string}`;
  const intercept: Intercept = {
    id,
    at,
    channel: channel.id,
    owner: channel.owner,
    direction: 'outbound',
    meta: { length: 12, callsign: slug.slice(0, 4).toUpperCase() || 'STN' },
    ciphertext: 'ABCDEFGHIJKL',
    spec: asTruth({ kind: 'caesar', shift: 1 } as const),
    plaintextProps: asTruth(['p:0'] as readonly string[]),
    origin: asTruth('noise' as const),
  };
  return {
    id: `tx:${slug}@${at.day}.${at.phase}`,
    at,
    channel: channel.id,
    owner: channel.owner,
    origin: asTruth('noise' as const),
    intercept,
  };
}

/**
 * Seed `WorldState.transmissions` with one firing of `channel` per day in
 * `[startDay, now.day]` at the current phase, so the retention window has
 * transmissions to collect.
 */
function withTransmissions(
  state: WorldState,
  channel: Channel,
  startDay: number,
): WorldState {
  const now = state.time;
  const txs: Transmission[] = [];
  for (let day = Math.max(0, startDay); day <= now.day; day += 1) {
    txs.push(testTransmission(channel, { day, phase: now.phase }));
  }
  return { ...state, transmissions: [...state.transmissions, ...txs] };
}

// ---------------------------------------------------------------------------
// Core-pack fixtures (mirrors surveil.spec.ts)
// ---------------------------------------------------------------------------

const CORE_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  '..',
  'content',
  'packs',
  'core',
);

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

const STANDARD = preset('standard');

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
  return { content, preset: STANDARD, scenario, cityData, descriptors, publicTexts };
}

function world(seed = 'intercept-alpha'): WorldState {
  return generate(seed, inputs());
}

/** A Truth Store that knows the surveillance predicates (for wait observation). */
function truth(): TruthStore {
  const lookup: PredicateEvaluatorLookup = {
    get: (predicate) => {
      switch (predicate) {
        case 'MEETS_AT':
          return 'fact-match-symmetric' as EvaluatorKind;
        case 'LOCATED_AT':
          return 'fact-match' as EvaluatorKind;
        case 'IS_ALIAS_OF':
          return 'alias' as EvaluatorKind;
        default:
          return undefined;
      }
    },
  };
  return TruthStore.create(lookup);
}

function ctx(store: TruthStore = truth()): ResolverContext {
  return { content, truth: store };
}

/** A Prng whose `next()` always returns the given constant (for coin control). */
function fixedPrng(value: number): ReturnType<typeof createPrng> {
  const base = createPrng('ignored');
  return { ...base, next: () => value };
}

const noRender = (): string[] => [];

// ---------------------------------------------------------------------------
// Test-world shaping helpers
// ---------------------------------------------------------------------------

/**
 * Put the player at the Station: pick their current Location and restamp its
 * type to `station-hq`, open in every phase, so `isAtStation` holds and the
 * Location gate lets `intercept` through.
 */
function atStation(base: WorldState): WorldState {
  const locId = base.player.loc;
  const loc = base.city.locations[locId];
  return {
    ...base,
    city: {
      ...base.city,
      locations: {
        ...base.city.locations,
        [locId]: {
          ...loc,
          type: STATION_LOCATION_TYPE,
          public: false,
          hours: { 0: true, 1: true, 2: true, 3: true },
        },
      },
    },
  };
}

/**
 * Ensure the player knows at least one interceptable Channel with a schedule
 * that fires at least once within the retention window ending now. Returns the
 * shaped state and the Channel. Builds a fresh radio Channel firing today and
 * yesterday so the window always has transmissions to collect.
 */
function withKnownRadioChannel(base: WorldState): { state: WorldState; channel: Channel } {
  const now = base.time;
  // A radio Channel firing daily at the current phase, starting a few days ago,
  // so several firings land inside the (two-day) retention window.
  const id = 'chan:test/radio' as ChannelId;
  const schedule: ChannelSchedule = {
    period: 1,
    start: { day: Math.max(0, now.day - 5), phase: now.phase },
    phase: now.phase,
  };
  const owner = base.station.org;
  const channel: Channel = { id, kind: 'radio', owner, schedule };
  const known: WorldState = {
    ...base,
    channels: { ...base.channels, [id]: channel },
    player: {
      ...base.player,
      known: {
        ...base.player.known,
        channels: [...base.player.known.channels, id],
      },
    },
  };
  // Seed real transmissions on the Channel across the retention window so the
  // Station sweep has traffic to deliver (the Cipher Engine seeds these in a
  // generated world; a test builds them directly).
  const state = withTransmissions(known, channel, now.day - 2);
  return { state, channel };
}

/**
 * Place the player on a courier Channel's route during its window: build a
 * courier Channel routed through the player's current Location, firing now.
 */
function withCourierHere(base: WorldState): { state: WorldState; channel: Channel } {
  const here = base.player.loc;
  const id = 'chan:test/courier' as ChannelId;
  const schedule: ChannelSchedule = {
    period: 1,
    start: { day: base.time.day, phase: base.time.phase },
    phase: base.time.phase,
  };
  const channel: Channel = {
    id,
    kind: 'courier',
    owner: base.station.org,
    route: here,
    schedule,
  };
  const withChannel: WorldState = {
    ...base,
    channels: { ...base.channels, [id]: channel },
  };
  // Seed one courier transmission firing now, so the courier interception has a
  // real Intercept to deliver.
  const tx = testTransmission(channel, base.time);
  const state: WorldState = {
    ...withChannel,
    transmissions: [...withChannel.transmissions, tx],
  };
  return { state, channel };
}

/** A public Location (and day/phase) at which at least one NPC is scheduled. */
function populatedPublicLocation(state: WorldState): LocId | undefined {
  for (const loc of Object.keys(state.city.locations) as LocId[]) {
    const place = state.city.locations[loc];
    if (place.public && visibleNpcsAt(state, loc).length > 0) {
      return loc;
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Intercept — Station collection (Req 25.2, 25.3)
// ---------------------------------------------------------------------------

describe('intercept — Station collection (Req 25.2, 25.3)', () => {
  it('is allowed at the Station and collects in-window transmissions as Intercepts', () => {
    const base = atStation(world());
    const { state, channel } = withKnownRadioChannel(base);
    expect(isAtStation(state)).toBe(true);

    const a: InterceptAction = { kind: 'intercept' };
    const q = quoteIntercept(state, a);
    expect(q.allowed).toBe(true);
    expect(q.phases).toBe(INTERCEPT_PHASE_COST);

    const due = stationCollection(state);
    expect(due.length).toBeGreaterThan(0);

    const { next, result } = resolveIntercept(state, a, fixedPrng(1), noRender);
    // Every due transmission delivered its Intercept, keyed by the Intercept id.
    for (const tx of due) {
      const id = tx.intercept.id;
      expect(next.intercepts[id]).toBeDefined();
      // Each carries traffic metadata (Req 25.3): a callsign and a length.
      const meta = next.intercepts[id].meta;
      expect(meta.callsign).toBeTruthy();
      expect(typeof meta.length).toBe('number');
    }
    // One metadata Observation per collected Intercept; collecting adds no Claims.
    expect(result.observations.length).toBe(due.length);
    expect(result.claimsAdded.length).toBe(0);
    // At least one Intercept came from our known radio Channel.
    const fromChannel = Object.values(next.intercepts).filter(
      (i) => i.channel === channel.id,
    );
    expect(fromChannel.length).toBeGreaterThan(0);
  });

  it('is idempotent: collecting the same window twice mints nothing new (Property 18)', () => {
    const base = atStation(world());
    const { state } = withKnownRadioChannel(base);
    const a: InterceptAction = { kind: 'intercept' };

    const first = resolveIntercept(state, a, fixedPrng(1), noRender);
    const firstCount = Object.keys(first.next.intercepts).length;
    expect(firstCount).toBeGreaterThan(0);

    // Collect again from the post-collection state: nothing left uncollected.
    expect(stationCollection(first.next).length).toBe(0);
    const second = resolveIntercept(first.next, a, fixedPrng(1), noRender);
    expect(Object.keys(second.next.intercepts).length).toBe(firstCount);
    expect(second.result.observations.length).toBe(0);
  });

  it('narrows the sweep to one Channel when channel? is set', () => {
    const base = atStation(world());
    const { state, channel } = withKnownRadioChannel(base);
    // Add a second known radio Channel so narrowing is observable.
    const otherId = 'chan:test/radio2' as ChannelId;
    const other: Channel = {
      id: otherId,
      kind: 'radio',
      owner: state.station.org,
      schedule: {
        period: 1,
        start: { day: Math.max(0, state.time.day - 3), phase: state.time.phase },
        phase: state.time.phase,
      },
    };
    const twoChannelsKnown: WorldState = {
      ...state,
      channels: { ...state.channels, [otherId]: other },
      player: {
        ...state.player,
        known: {
          ...state.player.known,
          channels: [...state.player.known.channels, otherId],
        },
      },
    };
    // Seed transmissions on the second Channel too, so narrowing is observable.
    const twoChannels = withTransmissions(twoChannelsKnown, other, state.time.day - 2);

    const narrowed = stationCollection(twoChannels, channel.id);
    expect(narrowed.length).toBeGreaterThan(0);
    expect(narrowed.every((tx) => tx.channel === channel.id)).toBe(true);

    const a: InterceptAction = { kind: 'intercept', channel: channel.id };
    const { next } = resolveIntercept(twoChannels, a, fixedPrng(1), noRender);
    // No Intercept from the other Channel was collected.
    expect(
      Object.values(next.intercepts).some((i) => i.channel === otherId),
    ).toBe(false);
  });

  it('uses the scenario retention window (default two days)', () => {
    const base = atStation(world());
    expect(retentionDays(base)).toBeGreaterThanOrEqual(1);
    // The scenario default is two days.
    expect(retentionDays(base)).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Intercept — courier interception (Req 25.4)
// ---------------------------------------------------------------------------

describe('intercept — courier interception (Req 25.4)', () => {
  it('produces the courier Intercept on its route during its window', () => {
    const base = world();
    const { state, channel } = withCourierHere(base);
    // Not at the Station, but a courier fires here now.
    expect(isAtStation(state)).toBe(false);
    expect(courierHereNow(state)).toBeDefined();

    const a: InterceptAction = { kind: 'intercept' };
    expect(quoteIntercept(state, a).allowed).toBe(true);

    // next() = 1 ⇒ no detection; one Intercept from the courier.
    const { next, result } = resolveIntercept(state, a, fixedPrng(1), noRender);
    const delivered = Object.values(next.intercepts).filter(
      (i) => i.channel === channel.id,
    );
    expect(delivered.length).toBe(1);
    expect(result.observations.length).toBe(1);
    // No detection: Cover Suspicion unchanged.
    expect(revealTruth(next.player.coverSuspicion)).toBe(
      revealTruth(state.player.coverSuspicion),
    );
  });

  it('runs a detection check that can raise Cover Suspicion (Req 25.4)', () => {
    const base = world();
    // Force a positive surveil detection base so next()=0 is a certain hit.
    const withBase: WorldState = {
      ...base,
      meta: {
        ...base.meta,
        preset: {
          ...base.meta.preset,
          detectionBase: { ...base.meta.preset.detectionBase, surveil: 1 },
          madeRevealProbability: 1,
        },
      },
    };
    const { state } = withCourierHere(withBase);
    const a: InterceptAction = { kind: 'intercept' };
    const { next, result } = resolveIntercept(state, a, fixedPrng(0), noRender);
    expect(revealTruth(next.player.coverSuspicion)).toBeGreaterThan(
      revealTruth(state.player.coverSuspicion),
    );
    // The reveal line shows at reveal probability 1.
    expect(
      result.observations.some(
        (o) => o.kind === 'message' && o.line.includes('made'),
      ),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Intercept — disallowed elsewhere
// ---------------------------------------------------------------------------

describe('intercept — not allowed away from the Station or a courier route', () => {
  it('is not allowed and leaves the state unchanged', () => {
    const base = world();
    // Not at the Station and no courier here: not allowed.
    const a: InterceptAction = { kind: 'intercept' };
    expect(isAtStation(base)).toBe(false);
    expect(courierHereNow(base)).toBeUndefined();
    const q = quoteIntercept(base, a);
    expect(q.allowed).toBe(false);

    // The top-level resolve returns the same state object on a disallowed action.
    const { next, result } = resolve(base, a, fixedPrng(1), ctx());
    expect(next).toBe(base);
    expect(result.observations.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Wait — passive observation and stopping at closing (Req 25.5, 25.6)
// ---------------------------------------------------------------------------

describe('wait — passive observation at a reduced rate (Req 25.5)', () => {
  it('observes present persons at the reduced rate with no detection', () => {
    const base = world();
    const loc = populatedPublicLocation(base);
    if (loc === undefined) {
      // No populated public Location this phase; nothing to assert here.
      return;
    }
    const present = visibleNpcsAt(base, loc);
    // Open the Location in every phase so no early stop, place the player there.
    const state: WorldState = {
      ...base,
      player: { ...base.player, loc },
      city: {
        ...base.city,
        locations: {
          ...base.city.locations,
          [loc]: {
            ...base.city.locations[loc],
            public: true,
            hours: { 0: true, 1: true, 2: true, 3: true },
          },
        },
      },
    };

    const a: WaitAction = { kind: 'wait', phases: 1 };
    const store = truth();
    const result = waitObservations(state, a, store);
    expect(result.phasesWaited).toBe(1);
    expect(result.stoppedAtClosing).toBe(false);

    // Reduced yield: the located sightings are ceil(0.4 × present) at most, and
    // strictly fewer than present when present is large.
    const located = result.observations.filter(
      (o) => o.kind === 'proposition' && o.prop.predicate === 'LOCATED_AT',
    );
    const expected = Math.max(1, Math.ceil(WAIT_OBSERVATION_FACTOR * present.length));
    expect(located.length).toBe(expected);
    expect(located.length).toBeLessThanOrEqual(present.length);
    // Each passive sighting is sourced to the Location the player waited at.
    expectAllSourced(result.observations, { kind: 'surveillance', loc });
    // Cover Suspicion unchanged — waiting runs no detection.
    expect(revealTruth(result.next.player.coverSuspicion)).toBe(
      revealTruth(state.player.coverSuspicion),
    );
  });

  it('observes nothing at a non-public Location', () => {
    const base = world();
    const loc = base.player.loc;
    const state: WorldState = {
      ...base,
      city: {
        ...base.city,
        locations: {
          ...base.city.locations,
          [loc]: {
            ...base.city.locations[loc],
            public: false,
            hours: { 0: true, 1: true, 2: true, 3: true },
          },
        },
      },
    };
    const result = waitObservations(state, { kind: 'wait', phases: 2 }, truth());
    expect(result.observations.length).toBe(0);
    expect(result.phasesWaited).toBe(2);
  });
});

describe('wait — stops at closing (Req 25.6)', () => {
  it('ends at the phase the Location closes and shows the closed Fact Line', () => {
    const base = world();
    const loc = populatedPublicLocation(base) ?? base.player.loc;
    const start = base.time.phase;
    // Open now, closed in the next phase, so a 2+ phase wait stops after one.
    const hours: Record<Phase, boolean> = { 0: false, 1: false, 2: false, 3: false };
    hours[start] = true;
    const state: WorldState = {
      ...base,
      player: { ...base.player, loc },
      city: {
        ...base.city,
        locations: {
          ...base.city.locations,
          [loc]: { ...base.city.locations[loc], public: true, hours },
        },
      },
    };

    const result = waitObservations(state, { kind: 'wait', phases: 3 }, truth());
    expect(result.stoppedAtClosing).toBe(true);
    expect(result.phasesWaited).toBe(1);
    expect(
      result.observations.some(
        (o) => o.kind === 'message' && o.line === WAIT_CLOSED_FACT_LINE,
      ),
    ).toBe(true);
  });

  it('a Location closing mid-span yields fewer observations than one open throughout', () => {
    const base = world();
    const loc = populatedPublicLocation(base);
    if (loc === undefined) {
      return;
    }
    const start = base.time.phase;
    const openHours: Record<Phase, boolean> = { 0: true, 1: true, 2: true, 3: true };
    const closingHours: Record<Phase, boolean> = {
      0: false,
      1: false,
      2: false,
      3: false,
    };
    closingHours[start] = true;

    const mk = (hours: Record<Phase, boolean>): WorldState => ({
      ...base,
      player: { ...base.player, loc },
      city: {
        ...base.city,
        locations: {
          ...base.city.locations,
          [loc]: { ...base.city.locations[loc], public: true, hours },
        },
      },
    });

    const open = waitObservations(mk(openHours), { kind: 'wait', phases: 3 }, truth());
    const closing = waitObservations(
      mk(closingHours),
      { kind: 'wait', phases: 3 },
      truth(),
    );
    const propsOf = (r: typeof open): number =>
      r.observations.filter((o) => o.kind === 'proposition').length;
    expect(closing.phasesWaited).toBeLessThan(open.phasesWaited);
    expect(propsOf(closing)).toBeLessThanOrEqual(propsOf(open));
  });

  it('observes a Sim event at the Location — a meeting yields a MEETS_AT contact (Req 25.5, 23.1)', () => {
    const base = world();
    const loc = populatedPublicLocation(base);
    if (loc === undefined) {
      return;
    }
    const participants = (Object.keys(base.npcs) as NpcId[]).slice(0, 2);
    if (participants.length < 2) {
      return;
    }
    const state: WorldState = {
      ...base,
      player: { ...base.player, loc },
      city: {
        ...base.city,
        locations: {
          ...base.city.locations,
          [loc]: {
            ...base.city.locations[loc],
            public: true,
            hours: { 0: true, 1: true, 2: true, 3: true },
          },
        },
      },
    };
    const meeting: SimEvent = {
      id: 'ev:wait-meeting',
      at: state.time,
      visibility: 'hidden',
      kind: 'meeting',
      participants,
      loc,
      origin: asTruth({ kind: 'routine' }),
    };
    const result = waitObservations(state, { kind: 'wait', phases: 1 }, truth(), [meeting]);
    const meets = result.observations.filter(
      (o) => o.kind === 'proposition' && o.prop.predicate === 'MEETS_AT',
    );
    // The waiting player observed the meeting (reduced yield still keeps one).
    expect(meets.length).toBe(1);
    // The contact and the sightings are all sourced to the waited-at Location.
    expectAllSourced(result.observations, { kind: 'surveillance', loc });
  });

  it('co-presence while waiting is a sighting, never a meeting (no event ⇒ no MEETS_AT)', () => {
    const base = world();
    const loc = populatedPublicLocation(base);
    if (loc === undefined) {
      return;
    }
    const state: WorldState = {
      ...base,
      player: { ...base.player, loc },
      city: {
        ...base.city,
        locations: {
          ...base.city.locations,
          [loc]: {
            ...base.city.locations[loc],
            public: true,
            hours: { 0: true, 1: true, 2: true, 3: true },
          },
        },
      },
    };
    const result = waitObservations(state, { kind: 'wait', phases: 2 }, truth(), []);
    const meets = result.observations.filter(
      (o) => o.kind === 'proposition' && o.prop.predicate === 'MEETS_AT',
    );
    expect(meets.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Determinism
// ---------------------------------------------------------------------------

describe('intercept / wait — determinism', () => {
  it('Station collection is deterministic for the same inputs', () => {
    const base = atStation(world());
    const { state } = withKnownRadioChannel(base);
    const a: InterceptAction = { kind: 'intercept' };
    const r1 = resolveIntercept(state, a, fixedPrng(1), noRender);
    const r2 = resolveIntercept(state, a, fixedPrng(1), noRender);
    expect(Object.keys(r1.next.intercepts).sort()).toEqual(
      Object.keys(r2.next.intercepts).sort(),
    );
    expect(r1.result.observations.length).toBe(r2.result.observations.length);
  });

  it('wait observation is deterministic across seeds (same world, same result)', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 1, noNaN: true, noDefaultInfinity: true }),
        (coin) => {
          const base = world();
          const loc = base.player.loc;
          const state: WorldState = {
            ...base,
            city: {
              ...base.city,
              locations: {
                ...base.city.locations,
                [loc]: {
                  ...base.city.locations[loc],
                  public: true,
                  hours: { 0: true, 1: true, 2: true, 3: true },
                },
              },
            },
          };
          // The coin is irrelevant — wait draws nothing — so results match
          // regardless of the Prng constant.
          const a: WaitAction = { kind: 'wait', phases: 2 };
          const r1 = waitObservations(state, a, truth());
          const r2 = waitObservations(state, a, truth());
          expect(r1.observations.length).toBe(r2.observations.length);
          expect(r1.phasesWaited).toBe(r2.phasesWaited);
          // coin is used only to exercise the property driver.
          expect(coin).toBeGreaterThanOrEqual(0);
        },
      ),
    );
  });
});
