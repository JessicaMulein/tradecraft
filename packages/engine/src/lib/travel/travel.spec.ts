import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { join } from 'node:path';

import { generateRegion } from '../region/generate.js';
import { regionCatalog, type RegionCatalog } from '../region/catalog.js';
import { loadRegionContent, regionSources } from '../region/load.js';
import { ScenarioConfigSchema, type ScenarioConfig } from '../config/scenario-config.js';
import { balance } from '../station/ledger.js';
import { timeToPhases } from '../model/core.js';
import { addPhases } from '../clock/clock.js';
import { createPrng } from '../prng/prng.js';
import { emptyStreetOpsState } from '../street-ops/state.js';
import { streetReplayHeader } from '../street-ops/stream.js';
import { quoteDepart, resolveDepart } from './depart.js';
import { moveOnSpine, phasesBetween, placementsMatch } from './move.js';
import { decideVisa } from './papers.js';
import type { ContentSet, DifficultyPreset } from '@tradecraft/content';

const PACKS = join(import.meta.dirname, '../../../../content/packs');
const FIXTURES = join(import.meta.dirname, '../region/fixtures');

function loadPack(): { content: ContentSet; catalog: RegionCatalog; template: string } {
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

const pack = loadPack();

function difficultyOf(content: ContentSet, id: string): DifficultyPreset {
  for (const [key, value] of content.difficultyPresets) {
    if (key === id || key.endsWith(`/${id}`)) {
      return value;
    }
  }
  throw new Error(`no difficulty preset ${id}`);
}
function preset() {
  for (const value of pack.catalog.presets.values()) {
    if (value.preset === 'standard') {
      return value;
    }
  }
  throw new Error('no standard preset');
}

function world(seed: string) {
  const scenario: ScenarioConfig = ScenarioConfigSchema.parse({
    difficulty: { preset: 'standard' },
    mole: false,
    region: { template: pack.template },
    recruitment: {
      pitch: { w1: 1, w2: 1, w3: 1, w4: 1 },
      firstContact: { a: 1, b: 1, c: 1, d: 1 },
      meeting: { trust: 1, riskAversion: 1, scheduleConflict: 1, agendaInterest: 1 },
      exposure: { k1: 1, k2: 1, k3: 1 },
      turn: { w1: 1, w2: 1, w3: 1, w4: 1, w5: 1 },
    },
  });
  const difficulty = difficultyOf(pack.content, 'standard');
  return generateRegion({
    seed,
    content: pack.content,
    catalog: pack.catalog,
    preset: difficulty,
    regionalPreset: preset(),
    scenario,
  });
}

describe('travel documents', () => {
  it('grants a visa when suspicion is clear and refuses one when it is certain', () => {
    expect(decideVisa(0, createPrng('visa'))).toBe(true);
    expect(decideVisa(1, createPrng('visa'))).toBe(false);
  });
});

describe('intercity travel', () => {
  it('refunds the fare when weather cancels the departure', () => {
    const state = world('cancel');
    const region = state.region;
    if (region === undefined) {
      throw new Error('expected a region');
    }
    const route = Object.values(region.intercity).find((item) => item.fromCity === state.player.city);
    if (route === undefined || route.fromCity === undefined) {
      throw new Error('expected a route out of the hub');
    }
    const origin = region.cities[route.fromCity];
    if (origin === undefined) {
      throw new Error('expected the origin city');
    }
    const snowed = {
      ...state,
      player: { ...state.player, loc: route.from },
      locationOf: {
        ...(state.locationOf ?? {}),
        player: { city: route.fromCity, loc: route.from },
      },
      region: {
        ...region,
        cities: {
          ...region.cities,
          [route.fromCity]: { ...origin, weather: { ...origin.weather, condition: 'snow' } },
        },
      },
    };
    const action = {
      kind: 'depart' as const,
      route: route.id,
      at: snowed.time,
      papers: snowed.player.papers ?? [],
    };
    const resolved = resolveDepart(snowed, action, createPrng('cancel'));
    expect(resolved.result.factLines.some((line) => line.includes('cancelled'))).toBe(true);
    expect(balance(resolved.next.station.ledger)).toBe(balance(snowed.station.ledger));
    expect(resolved.next.player.loc).toBe(route.from);
  });

  it('checks a carried car at the border and closes the drive on arrival', () => {
    const state = world('street-border');
    const region = state.region;
    if (region === undefined) throw new Error('expected a region');
    const route = Object.values(region.intercity).find(
      (item) => item.fromCity === state.player.city && item.borders.length > 0,
    );
    if (route === undefined || route.fromCity === undefined) throw new Error('expected a bordered route');
    const posts = { ...region.borderPosts };
    for (const id of route.borders) {
      const post = posts[id];
      if (post === undefined) continue;
      posts[id] = { ...post, strictness: 0, documents: [] };
    }
    const openRoute = { ...route, departures: undefined, timetable: 'daily', cancellingWeather: [] };
    const standing = {
      ...state,
      player: { ...state.player, loc: route.from },
      locationOf: {
        ...(state.locationOf ?? {}),
        player: { city: route.fromCity, loc: route.from },
      },
      region: {
        ...region,
        borderPosts: posts,
        intercity: { ...region.intercity, [route.id]: openRoute },
      },
    };
    const car = emptyStreetOpsState(streetReplayHeader());
    const withCar = {
      ...standing,
      ext: {
        streetOps: {
          ...car,
          vehicles: [{ id: 'staff-saloon', def: 'staff-saloon', plate: 'W-BURNED', knownBurned: false }],
          notedPlates: ['W-BURNED'],
          session: {
            sessionKey: 'open',
            vehicle: 'staff-saloon',
            at: { segment: 'court-lane', dir: 'fwd' as const, progress: 0 },
            speed: 'normal' as const,
            ticks: 0,
            phasesCharged: 0,
            path: [],
            passengers: [],
          },
        },
      },
    };
    const action = {
      kind: 'depart' as const,
      route: route.id,
      at: withCar.time,
      papers: withCar.player.papers ?? [],
    };
    const held = resolveDepart(withCar, action, createPrng('street-border-hold'));
    expect(held.result.factLines.some((line) => line.includes('detains'))).toBe(true);
    expect(held.next.player.loc).toBe(route.from);
    expect(held.next.ext?.streetOps?.session).toBeTruthy();
    const clear = {
      ...withCar,
      ext: {
        streetOps: {
          ...withCar.ext.streetOps,
          notedPlates: [],
        },
      },
    };
    const gone = resolveDepart(clear, action, createPrng('street-border-go'));
    expect(gone.result.factLines.some((line) => line.includes('detains') || line.includes('refuses'))).toBe(false);
    expect(gone.next.player.city).toBe(route.toCity);
    expect(gone.next.ext?.streetOps?.session).toBeUndefined();
    expect(gone.next.ext?.streetOps?.vehicles.map((item) => item.plate)).toEqual(['W-BURNED']);
  });

  it('Property 5: Cross-City truth consistency', () => {
    // Feature: multi-city, Property 5: Cross-City truth consistency
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 6 }), (span) => {
        const start = { day: 1, phase: 0 as const };
        const end = addPhases(start, span);
        const spine = createPrng('spine').state();
        const boarded = moveOnSpine({}, spine, {
          city: 'city:north',
          who: 'npc:courier',
          transit: 'transit:rail-1-0',
          board: true,
          at: start,
          duration: span,
        });
        const arrived = moveOnSpine(boarded.locationOf, boarded.spine, {
          city: 'city:north',
          who: 'npc:courier',
          transit: 'transit:rail-1-0',
          board: false,
          dest: { city: 'city:east', loc: 'loc:halt' },
          at: end,
          duration: span,
        });
        const transits = { 'transit:rail-1-0': { travellers: ['npc:courier'] } };
        expect(placementsMatch(boarded.locationOf, transits)).toBe(true);
        expect(placementsMatch(arrived.locationOf, transits)).toBe(true);
        expect(phasesBetween(start, end)).toBeGreaterThanOrEqual(span);
        expect(boarded.locationOf['npc:courier']).toEqual({ transit: 'transit:rail-1-0' });
        expect(arrived.locationOf['npc:courier']).toEqual({ city: 'city:east', loc: 'loc:halt' });
      }),
      { numRuns: 100 },
    );
  });

  it('Property 10: Intercity travel accounting', () => {
    // Feature: multi-city, Property 10: Intercity travel accounting
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 12 }), (seed) => {
        const state = world(seed);
        const region = state.region;
        if (region === undefined) {
          throw new Error('expected a region');
        }
        const refused = resolveDepart(
          state,
          { kind: 'depart', route: 'route:missing', at: state.time, papers: [] },
          createPrng(seed),
        );
        expect(refused.next).toBe(state);

        const route = Object.values(region.intercity).find(
          (item) => item.fromCity === state.player.city && (item.timetable === 'morning' || item.timetable === 'daily'),
        );
        if (route === undefined || route.fromCity === undefined) {
          return;
        }
        const standing: typeof state = {
          ...state,
          player: { ...state.player, loc: route.from },
          locationOf: {
            ...(state.locationOf ?? {}),
            player: { city: route.fromCity, loc: route.from },
          },
        };
        const papers = standing.player.papers ?? [];
        const action = { kind: 'depart' as const, route: route.id, at: standing.time, papers };
        const quoted = quoteDepart(standing, action);
        if (!quoted.allowed) {
          throw new Error(quoted.reason ?? 'departure was not allowed');
        }
        const resolved = resolveDepart(standing, action, createPrng(`${seed}-go`));
        const added = resolved.result.factLines.reduce((sum, line) => {
          const match = /adds (\d+) phase/.exec(line);
          return match === null ? sum : sum + Number(match[1]);
        }, 0);
        const moved = timeToPhases(resolved.next.time) - timeToPhases(standing.time);
        const spent = balance(standing.station.ledger) - balance(resolved.next.station.ledger);
        const cancelled = resolved.result.factLines.some((line) => line.includes('cancelled'));
        const turned = resolved.result.factLines.some(
          (line) => line.includes('refuses') || line.includes('detains'),
        );
        if (cancelled) {
          expect(spent).toBe(0);
          expect(resolved.next.player.loc).toBe(route.from);
        } else if (turned) {
          expect(resolved.next.player.loc).toBe(route.from);
          expect(spent).toBe(route.fare);
        } else {
          expect(resolved.next.player.loc).toBe(route.to);
          expect(moved).toBe(quoted.phases + added);
          expect(spent).toBe(route.fare);
        }
      }),
      { numRuns: 100 },
    );
  });
});
