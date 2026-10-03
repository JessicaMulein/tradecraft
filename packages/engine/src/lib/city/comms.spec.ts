/**
 * Tests for Channel and Dead Drop generation (task 5.4; Requirements 24.5,
 * 25.1).
 *
 * These load the real core pack, its `city.yaml` and `descriptors.yaml`, run
 * the full step-1→5 core stream (city, orgs, principals, Plot, comms) on one
 * PRNG stream, and check the invariants the design fixes for the Plot's,
 * Hostile Service's and Station's Channels and Dead Drops:
 *
 * - the Plot, the Hostile Service and the Station each get comms (Req 24.5,
 *   25.1);
 * - every Channel has one of the four Glossary kinds, a real org/NPC owner and
 *   a well-formed transmission schedule;
 * - the Plot and the Hostile Service each own at least one interceptable
 *   (radio/numbers) Channel, so the Station can intercept them (Req 25.1);
 * - every Dead Drop sits at a Location whose Location Type allows dead drops,
 *   is owned by a real org/NPC, and the Plot's drop carries the operation's
 *   materiel (Req 24.5);
 * - `withDeadDropSites` binds the drops back onto their Locations;
 * - `transmissionTimes` enumerates a well-formed, ascending schedule;
 * - and — the determinism that underpins Property 1 — the same seed and content
 *   produce an identical result.
 */

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  loadCityData,
  loadContent,
  loadDescriptorData,
  type CityData,
  type ContentSet,
  type DescriptorData,
  type DifficultyPreset,
} from '@tradecraft/content';

import { createPrng } from '../prng/prng.js';
import {
  compareTime,
  revealTruth,
  timeToPhases,
  type GameTime,
  type LocId,
} from '../model/core.js';
import { generateCity } from './generate.js';
import { type City } from './city.js';
import {
  generateOrgs,
  generatePrincipals,
  type GeneratedOrgs,
  type GeneratedPrincipals,
} from './principals.js';
import { generatePlot, type PlotState } from './plot.js';
import {
  CHANNEL_KINDS,
  MAX_CHANNEL_PERIOD,
  MIN_CHANNEL_PERIOD,
  compareScheduleStart,
  deadDropLocations,
  generateComms,
  isInterceptableKind,
  isWellFormedSchedule,
  ownerIsReal,
  transmissionTimes,
  withDeadDropSites,
  type ChannelSchedule,
  type GeneratedComms,
} from './comms.js';

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
} {
  const content = loadContent([CORE_DIR], ['core']);
  if (!content.ok) {
    throw new Error(
      `core pack failed to load:\n${content.errors
        .map((e) => `  ${e.pack}/${e.file} ${e.path}: ${e.message}`)
        .join('\n')}`,
    );
  }
  const cityData = loadCityData(CORE_DIR);
  if (!cityData.ok) {
    throw new Error('city.yaml failed to load');
  }
  const descriptors = loadDescriptorData(CORE_DIR);
  if (!descriptors.ok) {
    throw new Error('descriptors.yaml failed to load');
  }
  return {
    content: content.value,
    cityData: cityData.value,
    descriptors: descriptors.value,
  };
}

const { content, cityData, descriptors } = loadCore();
const locationTypes = [...content.locationTypes.values()];

/** Resolve a named difficulty preset from the merged content set. */
function preset(id: string): DifficultyPreset {
  for (const [key, value] of content.difficultyPresets) {
    if (key === id || key.endsWith(`/${id}`)) {
      return value;
    }
  }
  throw new Error(`no difficulty preset ${id}`);
}

const STANDARD = preset('standard');
const START: GameTime = { day: 0, phase: 0 };

interface Generated {
  readonly city: City;
  readonly orgs: GeneratedOrgs;
  readonly principals: GeneratedPrincipals;
  readonly plot: PlotState;
  readonly comms: GeneratedComms;
}

/** Run the full step-1→5 generation on one core stream for a seed. */
function gen(seed: string, p: DifficultyPreset = STANDARD): Generated {
  const prng = createPrng(seed);
  const { city } = generateCity(prng, locationTypes, cityData);
  const orgs = generateOrgs(prng);
  const principals = generatePrincipals(prng, content, descriptors, city, orgs);
  const { plot } = generatePlot(prng, content, p, city, orgs, principals, START);
  const comms = generateComms(prng, content, city, orgs, principals, plot, START);
  return { city, orgs, principals, plot, comms };
}

const SEEDS = ['alpha', 'bravo', 'charlie', 'delta', 'echo-123', 'z'];

// ---------------------------------------------------------------------------
// Dead-drop-allowing Locations
// ---------------------------------------------------------------------------

describe('deadDropLocations', () => {
  it('returns only Locations whose type allows dead drops', () => {
    const { city } = gen('ddl-seed');
    const allowingTypes = new Set(
      [...content.locationTypes.values()]
        .filter((t) => t.allowsDeadDrops)
        .map((t) => t.id),
    );
    const locs = deadDropLocations(city, content);
    expect(locs.length).toBeGreaterThan(0);
    for (const loc of locs) {
      expect(allowingTypes.has(loc.type)).toBe(true);
    }
  });

  it('is id-sorted and order-independent', () => {
    const { city } = gen('ddl-order');
    const a = deadDropLocations(city, content).map((l) => l.id);
    const b = deadDropLocations(city, content).map((l) => l.id);
    expect(a).toEqual(b);
    expect([...a].sort()).toEqual(a);
  });
});

// ---------------------------------------------------------------------------
// Each operation gets comms (Req 24.5, 25.1)
// ---------------------------------------------------------------------------

describe('generateComms — the Plot, Hostile Service and Station each get comms', () => {
  it('gives the Plot a signal, a courier and a dead-drop Channel, and a drop', () => {
    for (const seed of SEEDS) {
      const { comms } = gen(seed);
      expect(comms.plotChannels.length).toBe(3);
      // The three Plot Channels cover a signal, a courier and a dead-drop.
      const kinds = comms.plotChannels.map((id) => comms.channels[id].kind);
      expect(kinds).toContain('courier');
      expect(kinds).toContain('dead-drop');
      expect(kinds.some((k) => k === 'radio' || k === 'numbers')).toBe(true);
      expect(comms.deadDrops[comms.plotDrop]).toBeDefined();
    }
  });

  it('gives the Hostile Service a signal Channel and a drop', () => {
    for (const seed of SEEDS) {
      const { comms } = gen(seed);
      expect(comms.hostileChannels.length).toBeGreaterThanOrEqual(1);
      const kinds = comms.hostileChannels.map((id) => comms.channels[id].kind);
      expect(kinds.some(isInterceptableKind)).toBe(true);
      expect(comms.deadDrops[comms.hostileDrop]).toBeDefined();
    }
  });

  it('gives the Station a radio Channel and a drop', () => {
    for (const seed of SEEDS) {
      const { comms, orgs } = gen(seed);
      expect(comms.stationChannels.length).toBeGreaterThanOrEqual(1);
      const station = comms.channels[comms.stationChannels[0]];
      expect(station.kind).toBe('radio');
      expect(station.owner).toBe(orgs.station.id);
      expect(comms.deadDrops[comms.stationDrop]).toBeDefined();
    }
  });

  it('the Plot and Hostile Service each own an interceptable Channel (Req 25.1)', () => {
    for (const seed of SEEDS) {
      const { comms } = gen(seed);
      const plotInterceptable = comms.plotChannels
        .map((id) => comms.channels[id])
        .some((c) => isInterceptableKind(c.kind));
      const hostileInterceptable = comms.hostileChannels
        .map((id) => comms.channels[id])
        .some((c) => isInterceptableKind(c.kind));
      expect(plotInterceptable).toBe(true);
      expect(hostileInterceptable).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Channel invariants
// ---------------------------------------------------------------------------

describe('generateComms — Channels', () => {
  it('every Channel has a known kind, a real owner and a well-formed schedule', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 12 }), (seed) => {
        const { comms, orgs, principals } = gen(seed);
        const all = Object.values(comms.channels);
        expect(all.length).toBeGreaterThan(0);
        for (const channel of all) {
          expect(CHANNEL_KINDS).toContain(channel.kind);
          expect(ownerIsReal(channel.owner, orgs, principals)).toBe(true);
          expect(isWellFormedSchedule(channel.schedule)).toBe(true);
          expect(channel.schedule.period).toBeGreaterThanOrEqual(MIN_CHANNEL_PERIOD);
          expect(channel.schedule.period).toBeLessThanOrEqual(MAX_CHANNEL_PERIOD);
          // Schedules never fire before the game starts.
          expect(channel.schedule.start.day).toBeGreaterThanOrEqual(START.day);
        }
      }),
      { numRuns: 40 },
    );
  });

  it('a courier Channel carries a real route Location; others do not', () => {
    for (const seed of SEEDS) {
      const { comms, city } = gen(seed);
      for (const channel of Object.values(comms.channels)) {
        if (channel.kind === 'courier') {
          expect(channel.route).toBeDefined();
          expect(city.locations[channel.route as LocId]).toBeDefined();
        } else {
          expect(channel.route).toBeUndefined();
        }
      }
    }
  });

  it('keys the channel record by each Channel id', () => {
    const { comms } = gen('key-seed');
    for (const [id, channel] of Object.entries(comms.channels)) {
      expect(channel.id).toBe(id);
    }
  });
});

// ---------------------------------------------------------------------------
// Dead Drop invariants (Req 24.5)
// ---------------------------------------------------------------------------

describe('generateComms — Dead Drops', () => {
  it('places every drop at a dead-drop-allowing Location, with a real owner', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 12 }), (seed) => {
        const { comms, city, orgs, principals } = gen(seed);
        const allowing = new Set(deadDropLocations(city, content).map((l) => l.id));
        const drops = Object.values(comms.deadDrops);
        expect(drops.length).toBe(3);
        for (const drop of drops) {
          expect(allowing.has(drop.loc)).toBe(true);
          expect(ownerIsReal(drop.owner, orgs, principals)).toBe(true);
        }
      }),
      { numRuns: 40 },
    );
  });

  it('threads the Plot materiel into the Plot drop (Req 24.5)', () => {
    for (const seed of SEEDS) {
      const { comms, plot } = gen(seed);
      const drop = comms.deadDrops[comms.plotDrop];
      expect(drop.contents).toContain(revealTruth(plot.materiel));
    }
  });

  it('keys the drop record by each Dead Drop id', () => {
    const { comms } = gen('drop-key-seed');
    for (const [id, drop] of Object.entries(comms.deadDrops)) {
      expect(drop.id).toBe(id);
    }
  });

  it('throws when the city has no dead-drop-allowing Location', () => {
    const { city, orgs, principals, plot } = gen('throw-seed');
    const stripped = {
      ...content,
      locationTypes: new Map(
        [...content.locationTypes.entries()].map(([k, t]) => [
          k,
          { ...t, allowsDeadDrops: false },
        ]),
      ),
    } as unknown as ContentSet;
    expect(() =>
      generateComms(createPrng('x'), stripped, city, orgs, principals, plot, START),
    ).toThrow(/no dead-drop-allowing Location/);
  });
});

// ---------------------------------------------------------------------------
// withDeadDropSites
// ---------------------------------------------------------------------------

describe('withDeadDropSites', () => {
  it('binds each generated drop onto its Location, leaving others empty', () => {
    for (const seed of SEEDS) {
      const { city, comms } = gen(seed);
      const bound = withDeadDropSites(city, comms);
      // Every generated drop appears in exactly its Location's site list.
      for (const drop of Object.values(comms.deadDrops)) {
        expect(bound.locations[drop.loc].deadDropSites).toContain(drop.id);
      }
      // The total site count across the city equals the number of drops.
      const total = Object.values(bound.locations).reduce(
        (sum, loc) => sum + loc.deadDropSites.length,
        0,
      );
      expect(total).toBe(Object.keys(comms.deadDrops).length);
    }
  });

  it('does not mutate the input city', () => {
    const { city, comms } = gen('nomut-seed');
    const before = Object.values(city.locations).map((l) => l.deadDropSites.length);
    withDeadDropSites(city, comms);
    const after = Object.values(city.locations).map((l) => l.deadDropSites.length);
    expect(after).toEqual(before);
  });
});

// ---------------------------------------------------------------------------
// Schedules
// ---------------------------------------------------------------------------

describe('transmissionTimes', () => {
  it('enumerates firings at the start, +period, +2·period, … up to the horizon', () => {
    const schedule: ChannelSchedule = { period: 2, start: { day: 1, phase: 2 }, phase: 2 };
    const times = transmissionTimes(schedule, 7);
    expect(times.map((t) => t.day)).toEqual([1, 3, 5, 7]);
    for (const t of times) {
      expect(t.phase).toBe(2);
    }
  });

  it('yields ascending times, all at the schedule phase, for drawn schedules', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 10 }), (seed) => {
        const { comms } = gen(seed);
        for (const channel of Object.values(comms.channels)) {
          const times = transmissionTimes(channel.schedule, 30);
          expect(times.length).toBeGreaterThan(0);
          for (let i = 1; i < times.length; i += 1) {
            expect(compareTime(times[i - 1], times[i])).toBeLessThan(0);
          }
          for (const t of times) {
            expect(t.phase).toBe(channel.schedule.phase);
          }
        }
      }),
      { numRuns: 25 },
    );
  });

  it('yields an empty list when the horizon precedes the start', () => {
    const schedule: ChannelSchedule = { period: 1, start: { day: 5, phase: 0 }, phase: 0 };
    expect(transmissionTimes(schedule, 3)).toEqual([]);
  });

  it('compareScheduleStart orders by first-firing time', () => {
    const early: ChannelSchedule = { period: 1, start: { day: 0, phase: 1 }, phase: 1 };
    const late: ChannelSchedule = { period: 1, start: { day: 2, phase: 0 }, phase: 0 };
    expect(compareScheduleStart(early, late)).toBeLessThan(0);
    expect(compareScheduleStart(late, early)).toBeGreaterThan(0);
    expect(timeToPhases(early.start)).toBeLessThan(timeToPhases(late.start));
  });
});

describe('isWellFormedSchedule', () => {
  it('accepts a well-formed schedule and rejects malformed ones', () => {
    expect(isWellFormedSchedule({ period: 1, start: { day: 0, phase: 0 }, phase: 0 })).toBe(
      true,
    );
    // period < 1
    expect(isWellFormedSchedule({ period: 0, start: { day: 0, phase: 0 }, phase: 0 })).toBe(
      false,
    );
    // negative day
    expect(
      isWellFormedSchedule({ period: 1, start: { day: -1, phase: 0 }, phase: 0 }),
    ).toBe(false);
    // firing phase disagrees with start phase
    expect(
      isWellFormedSchedule({
        period: 1,
        start: { day: 0, phase: 0 },
        phase: 2,
      } as ChannelSchedule),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Determinism (underpins Property 1)
// ---------------------------------------------------------------------------

describe('generateComms — determinism', () => {
  it('produces an identical result for the same seed and content', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 12 }), (seed) => {
        const a = gen(seed).comms;
        const b = gen(seed).comms;
        expect(JSON.stringify(a)).toBe(JSON.stringify(b));
      }),
      { numRuns: 30 },
    );
  });

  it('different seeds generally produce different comms', () => {
    const a = JSON.stringify(gen('seed-one').comms);
    const b = JSON.stringify(gen('seed-two').comms);
    expect(a).not.toBe(b);
  });
});
