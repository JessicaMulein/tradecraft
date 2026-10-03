/**
 * Tests for Rumour and Noise-Traffic generation (task 6.3; Requirements 29.3,
 * 29.4; design, "Noise Generator", steps 3–4).
 *
 * These load the real core pack, its `city.yaml` and `descriptors.yaml`,
 * generate a city, the three orgs and the Principal NPCs on a core stream, then
 * run the Background-NPC generator (task 6.1) and the Side-Thread generator
 * (task 6.2) on an independent noise stream (`derive(seed, 0x10000)`), and
 * finally the Rumour and Noise-Traffic generators on that same stream. They
 * check the invariants the design and the requirements fix:
 *
 * Rumours (Req 29.3):
 * - every Rumour's Proposition is a genuine *distortion* of its source — it
 *   differs by a swapped subject, a shifted day, or an invented/replaced target;
 * - every Rumour is held as a *false belief* by a Background NPC
 *   (`falseBeliefsByHolder`), and the same list is available flat (newspapers);
 * - Rumour Proposition ids are fresh, distinct `prop:rumour/<n>` ids that cannot
 *   collide with core / Side-Thread / local prop ids.
 *
 * Noise Traffic (Req 29.4):
 * - channels are produced at the preset `noise : plot` ratio;
 * - every channel has a well-formed schedule and a non-colliding `chan:noise/…`
 *   id, and an interceptable kind so it competes with the signal;
 * - every owner is a noise source (`org:noise-<family>`), never a Station /
 *   Hostile / Cell org nor an NPC.
 *
 * Determinism (Req 29.5, Property 1): the same noise seed and inputs produce an
 * identical result for both generators. Numeric arbitraries are guarded with
 * `fc.double({ noNaN: true, noDefaultInfinity: true })` per the fast-check
 * guidance.
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
} from '@tradecraft/content';

import { createPrng, derive } from '../prng/prng.js';
import { type GameTime, type NpcId, type Proposition } from '../model/core.js';
import { generateCity } from '../city/generate.js';
import { type City } from '../city/city.js';
import {
  generateOrgs,
  generatePrincipals,
  type GeneratedOrgs,
  type GeneratedPrincipals,
} from '../city/principals.js';
import { isWellFormedSchedule } from '../city/comms.js';
import { generateBackgroundNpcs, type GeneratedBackgroundNpcs } from './background.js';
import { generateSideThreads, type GeneratedSideThreads } from './side-threads.js';
import {
  MAX_RUMOUR_DAY,
  NOISE_TRAFFIC_FAMILIES,
  NOISE_TRAFFIC_OWNERS,
  RUMOUR_PROP_PREFIX,
  generateNoiseTraffic,
  generateRumours,
  isNoiseOwner,
  noiseOrgId,
  noiseTrafficCount,
  rumourSourcePool,
  rumourTemplates,
  type GeneratedNoiseTraffic,
  type GeneratedRumours,
} from './rumours.js';

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

/** The noise stream base offset (design PRNG stream registry). */
const NOISE_STREAM_BASE = 0x10000;
/** The game start time generation uses as the schedule/window floor. */
const START: GameTime = { day: 0, phase: 0 };
/** How many Background NPCs to seed the pools with. */
const BACKGROUND_COUNT = 10;
/** How many Side Threads to seed the source pool with. */
const SIDE_THREAD_COUNT = 2;

interface Core {
  readonly city: City;
  readonly orgs: GeneratedOrgs;
  readonly principals: GeneratedPrincipals;
  readonly background: GeneratedBackgroundNpcs;
  readonly sideThreads: GeneratedSideThreads;
}

/**
 * Build the core world, the Background NPCs and the Side Threads for a seed, all
 * on a *fresh* noise stream so the subsequent Rumour draws start from a clean,
 * repeatable stream whose state depends only on the seed and the counts.
 */
function world(seed: string): Core {
  const corePrng = createPrng(seed);
  const { city } = generateCity(corePrng, locationTypes, cityData);
  const orgs = generateOrgs(corePrng);
  const principals = generatePrincipals(corePrng, content, descriptors, city, orgs);

  const noise = createPrng(derive(seed, NOISE_STREAM_BASE));
  const background = generateBackgroundNpcs(
    noise,
    content,
    descriptors,
    city,
    orgs,
    BACKGROUND_COUNT,
  );
  const sideThreads = generateSideThreads(
    noise,
    content,
    city,
    principals,
    background.npcs,
    SIDE_THREAD_COUNT,
    START,
  );
  return { city, orgs, principals, background, sideThreads };
}

/**
 * A couple of synthetic Plot source Propositions, standing in for the Plot's
 * true facts (task 6.4 passes the real Plot propositions). They use the
 * Predicate Vocabulary and name Background NPCs, so a swap/invent has somewhere
 * to go and a Rumour drawn from them is still well-formed.
 */
function plotPropositions(c: Core): Proposition[] {
  const ids = c.background.background.map((bg) => bg.npc.id);
  const locs = Object.values(c.city.locations).filter((l) => l.public).map((l) => l.id);
  if (ids.length < 2 || locs.length === 0) {
    return [];
  }
  return [
    {
      id: 'prop:plot/meet-0',
      subject: ids[0],
      predicate: 'MEETS_AT',
      object: ids[1],
      place: locs[0],
      window: { from: { day: 3, phase: 1 } },
    },
    {
      id: 'prop:plot/plan-0',
      subject: ids[0],
      predicate: 'PLANS',
      object: { kind: 'text', value: 'a delivery' },
      window: { from: { day: 2, phase: 0 } },
    },
  ];
}

/** Run Rumour generation on a fresh noise stream for a seed and count. */
function genRumours(seed: string, count: number): { c: Core; r: GeneratedRumours } {
  const c = world(seed);
  const noise = createPrng(derive(seed, NOISE_STREAM_BASE));
  const r = generateRumours(noise, content, plotPropositions(c), c.sideThreads, c.background, count);
  return { c, r };
}

/** Run Noise-Traffic generation on a fresh noise stream for a seed. */
function genTraffic(
  seed: string,
  plotSignalCount: number,
  ratio: { noise: number; plot: number },
): GeneratedNoiseTraffic {
  const noise = createPrng(derive(seed, NOISE_STREAM_BASE));
  return generateNoiseTraffic(noise, plotSignalCount, ratio, START);
}

/** Structural equality on the fields a distortion may touch. */
function sameShape(a: Proposition, b: Proposition): boolean {
  return (
    a.subject === b.subject &&
    a.predicate === b.predicate &&
    JSON.stringify(a.object) === JSON.stringify(b.object) &&
    a.place === b.place &&
    JSON.stringify(a.window) === JSON.stringify(b.window)
  );
}

describe('rumourTemplates', () => {
  it('returns the content set rumour templates, id-sorted', () => {
    const list = rumourTemplates(content);
    expect(list.length).toBeGreaterThanOrEqual(2); // Req 31.7
    const ids = list.map((t) => t.id);
    expect([...ids].sort()).toEqual(ids);
    for (const t of list) {
      expect(t.distortions.length).toBeGreaterThanOrEqual(1);
    }
  });
});

describe('rumourSourcePool (Req 29.3)', () => {
  it('merges Plot, Side-Thread and local Propositions, id-sorted and distinct', () => {
    const c = world('pool-seed');
    const pool = rumourSourcePool(plotPropositions(c), c.sideThreads, c.background);
    expect(pool.length).toBeGreaterThan(0);
    const ids = pool.map((p) => p.id);
    expect([...ids].sort()).toEqual(ids);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('generateRumours — distortion and false beliefs (Req 29.3)', () => {
  it('produces Rumours that are genuine distortions held as Background-NPC false beliefs', () => {
    const { c, r } = genRumours('rumour-seed', 6);
    // With a healthy source pool and roster, we get Rumours.
    expect(r.rumours.length).toBeGreaterThan(0);

    const sourceById = new Map(
      rumourSourcePool(plotPropositions(c), c.sideThreads, c.background).map((p) => [p.id, p]),
    );
    const holders = new Set(c.background.background.map((bg) => bg.npc.id));

    for (const rumour of r.rumours) {
      // Each Rumour declares at least one applied distortion.
      expect(rumour.distortions.length).toBeGreaterThan(0);

      // The source exists in the pool, and the distorted proposition DIFFERS
      // from it (swapped subject / shifted day / invented target).
      const source = sourceById.get(rumour.source);
      expect(source).toBeDefined();
      if (source !== undefined) {
        expect(rumour.proposition.predicate).toBe(source.predicate);
        expect(sameShape(rumour.proposition, source)).toBe(false);

        // The specific change matches the declared distortions.
        if (rumour.distortions.includes('swap-subject')) {
          // subject changed, OR (for symmetric meeting) object changed.
          const subjChanged = rumour.proposition.subject !== source.subject;
          expect(subjChanged).toBe(true);
        }
        if (rumour.distortions.includes('shift-day')) {
          const srcDay = source.window?.from.day;
          const newDay = rumour.proposition.window?.from.day;
          expect(newDay).toBeDefined();
          expect(newDay).not.toBe(srcDay);
          expect(newDay!).toBeGreaterThanOrEqual(0);
          expect(newDay!).toBeLessThanOrEqual(MAX_RUMOUR_DAY);
        }
        if (rumour.distortions.includes('invent-target')) {
          expect(JSON.stringify(rumour.proposition.object)).not.toBe(
            JSON.stringify(source.object),
          );
        }
      }

      // The Rumour is held by a real Background NPC.
      expect(holders.has(rumour.holder)).toBe(true);
    }

    // Every Rumour appears in its holder's false-belief list, and the flat list
    // and the keyed map agree.
    const flatByHolder = new Map<NpcId, Proposition[]>();
    for (const rumour of r.rumours) {
      const list = flatByHolder.get(rumour.holder) ?? [];
      list.push(rumour.proposition);
      flatByHolder.set(rumour.holder, list);
    }
    for (const [holder, props] of flatByHolder) {
      const kept = r.falseBeliefsByHolder[holder];
      expect(kept).toBeDefined();
      expect(new Set(kept.map((p) => p.id))).toEqual(new Set(props.map((p) => p.id)));
    }
  });

  it('mints fresh, distinct prop:rumour/<n> ids that cannot collide', () => {
    const { r } = genRumours('id-seed', 8);
    const ids = r.rumours.map((rm) => rm.proposition.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(id.startsWith(`prop:${RUMOUR_PROP_PREFIX}/`)).toBe(true);
    }
  });

  it('rejects a negative or non-integer count', () => {
    const c = world('reject-seed');
    const noise = createPrng(derive('reject-seed', NOISE_STREAM_BASE));
    expect(() =>
      generateRumours(noise, content, plotPropositions(c), c.sideThreads, c.background, -1),
    ).toThrow();
    expect(() =>
      generateRumours(noise, content, plotPropositions(c), c.sideThreads, c.background, 2.5),
    ).toThrow();
  });

  it('returns no Rumour when there is no Background NPC to hold one', () => {
    const seed = 'empty-bg';
    const corePrng = createPrng(seed);
    const { city } = generateCity(corePrng, locationTypes, cityData);
    const orgs = generateOrgs(corePrng);
    const principals = generatePrincipals(corePrng, content, descriptors, city, orgs);
    const noise = createPrng(derive(seed, NOISE_STREAM_BASE));
    const emptyBg = generateBackgroundNpcs(noise, content, descriptors, city, orgs, 0);
    const emptySt = generateSideThreads(noise, content, city, principals, emptyBg.npcs, 0, START);
    const r = generateRumours(noise, content, [], emptySt, emptyBg, 6);
    expect(r.rumours.length).toBe(0);
    expect(Object.keys(r.falseBeliefsByHolder).length).toBe(0);
  });
});

describe('noiseTrafficCount — preset ratio (Req 29.4)', () => {
  it('scales the signal count by noise : plot', () => {
    expect(noiseTrafficCount(3, { noise: 1, plot: 1 })).toBe(3);
    expect(noiseTrafficCount(3, { noise: 2, plot: 1 })).toBe(6);
    expect(noiseTrafficCount(3, { noise: 4, plot: 1 })).toBe(12);
    expect(noiseTrafficCount(0, { noise: 2, plot: 1 })).toBe(0);
    expect(noiseTrafficCount(-1, { noise: 2, plot: 1 })).toBe(0);
  });
});

describe('generateNoiseTraffic — channels at the preset ratio (Req 29.4)', () => {
  it('produces the ratio-many channels, well-formed, non-colliding, owned by noise sources', () => {
    const plotSignalCount = 3;
    const ratio = { noise: 2, plot: 1 };
    const nt = genTraffic('traffic-seed', plotSignalCount, ratio);

    const expected = noiseTrafficCount(plotSignalCount, ratio);
    expect(nt.traffic.length).toBe(expected);
    expect(Object.keys(nt.channels).length).toBe(expected);

    const ids = nt.traffic.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);

    for (const channel of nt.traffic) {
      expect(channel.id.startsWith('chan:noise/')).toBe(true);
      // Interceptable so it competes with the signal.
      expect(['radio', 'numbers']).toContain(channel.kind);
      expect(isWellFormedSchedule(channel.schedule)).toBe(true);
      expect(channel.schedule.start.day).toBeGreaterThanOrEqual(START.day);
      // Owner is a noise source, never a real org or NPC.
      expect(isNoiseOwner(channel.owner)).toBe(true);
      expect(NOISE_TRAFFIC_OWNERS).toContain(channel.owner);
    }

    // All three families appear across a six-channel mix, and the keyed/flat
    // views agree.
    const fromFamilies = [
      ...nt.byFamily.diplomatic,
      ...nt.byFamily.commercial,
      ...nt.byFamily.criminal,
    ];
    expect(new Set(fromFamilies)).toEqual(new Set(ids));
    for (const family of NOISE_TRAFFIC_FAMILIES) {
      expect(nt.byFamily[family].length).toBeGreaterThan(0);
    }
  });

  it('mints owner ids distinct from the three real orgs', () => {
    const c = world('owner-seed');
    const realOrgIds = new Set(Object.keys(c.orgs.orgs));
    for (const family of NOISE_TRAFFIC_FAMILIES) {
      expect(realOrgIds.has(noiseOrgId(family))).toBe(false);
    }
  });

  it('produces no channels when the signal count is zero', () => {
    const nt = genTraffic('zero-seed', 0, { noise: 2, plot: 1 });
    expect(nt.traffic.length).toBe(0);
  });
});

describe('generateRumours / generateNoiseTraffic — determinism (Req 29.5, Property 1)', () => {
  it('produces identical Rumours for the same noise seed and inputs', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 12 }),
        fc.integer({ min: 0, max: 8 }),
        (seed, count) => {
          const a = genRumours(seed, count);
          const b = genRumours(seed, count);
          expect(JSON.stringify(b.r)).toBe(JSON.stringify(a.r));
        },
      ),
      { numRuns: 25 },
    );
  });

  it('produces identical Noise Traffic for the same noise seed and inputs', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 12 }),
        fc.integer({ min: 0, max: 5 }),
        fc.integer({ min: 1, max: 4 }),
        (seed, signal, noiseSide) => {
          const ratio = { noise: noiseSide, plot: 1 };
          const a = genTraffic(seed, signal, ratio);
          const b = genTraffic(seed, signal, ratio);
          expect(JSON.stringify(b)).toBe(JSON.stringify(a));
        },
      ),
      { numRuns: 25 },
    );
  });

  it('guards numeric arbitraries so a count never degenerates', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 10 }),
        fc.double({ min: 0, max: 8, noNaN: true, noDefaultInfinity: true }),
        (seed, raw) => {
          const count = Math.floor(raw);
          const { r } = genRumours(seed, count);
          // Never more Rumours than requested (fewer only if the pool is thin).
          expect(r.rumours.length).toBeLessThanOrEqual(count);
        },
      ),
      { numRuns: 20 },
    );
  });
});
