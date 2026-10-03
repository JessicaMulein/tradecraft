/**
 * Tests for Background NPC generation (task 6.1; Requirement 29.1; design,
 * "Noise Generator", step 1).
 *
 * These load the real core pack, its `city.yaml` and `descriptors.yaml`,
 * generate a city and the three orgs on a core stream, then run the Background
 * NPC generator on an independent noise stream (`derive(seed, 0x10000)`) and
 * check the invariants the design and the requirement fix:
 *
 * - the generator produces exactly the requested count of Background NPCs, each
 *   stamped from a civilian archetype (Requirement 29.1);
 * - every Background NPC has a schedule, and every scheduled Location is a
 *   *public* Location of the generated city (design, step 1);
 * - every Background NPC has a non-empty local-facts Knowledge Slice holding
 *   only city/local Propositions — no org, Plot stage or Cell member appears,
 *   and there are no false beliefs yet (task 6.3 adds Rumours);
 * - ids are unique and cannot collide with Principal ids (the `npc:bg-` prefix);
 * - the true and apparent allegiance are civilian/neutral — a civilian serves
 *   no generated org; and
 * - determinism: the same noise seed, city and content produce an identical
 *   result (Requirement 29.5, underpinning Property 1).
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
import { revealTruth, type NpcId } from '../model/core.js';
import { generateCity } from '../city/generate.js';
import { type City } from '../city/city.js';
import { scheduledLocation } from '../city/npc.js';
import {
  generateOrgs,
  generatePrincipals,
  CELL_ORG_ID,
  HOSTILE_ORG_ID,
  STATION_ORG_ID,
  type GeneratedOrgs,
  type GeneratedPrincipals,
} from '../city/principals.js';
import {
  BACKGROUND_ID_PREFIX,
  NEUTRAL_ORG_ID,
  civilianArchetypes,
  generateBackgroundNpcs,
  type GeneratedBackgroundNpcs,
} from './background.js';

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

interface Core {
  readonly city: City;
  readonly orgs: GeneratedOrgs;
  readonly principals: GeneratedPrincipals;
}

/** Build the core world (city, orgs, principals) on the core stream for a seed. */
function core(seed: string): Core {
  const prng = createPrng(seed);
  const { city } = generateCity(prng, locationTypes, cityData);
  const orgs = generateOrgs(prng);
  const principals = generatePrincipals(prng, content, descriptors, city, orgs);
  return { city, orgs, principals };
}

/** Run Background NPC generation on the noise stream for a seed and count. */
function genNoise(seed: string, count: number): { c: Core; bg: GeneratedBackgroundNpcs } {
  const c = core(seed);
  const noise = createPrng(derive(seed, NOISE_STREAM_BASE));
  const bg = generateBackgroundNpcs(noise, content, descriptors, c.city, c.orgs, count);
  return { c, bg };
}

/** The set of public Location ids in a city. */
function publicLocIds(city: City): Set<string> {
  return new Set(
    Object.values(city.locations)
      .filter((l) => l.public)
      .map((l) => l.id),
  );
}

describe('civilianArchetypes', () => {
  it('returns only civilian-role archetypes, id-sorted', () => {
    const list = civilianArchetypes(content);
    expect(list.length).toBeGreaterThan(0);
    for (const a of list) {
      expect(a.role).toBe('civilian');
    }
    const ids = list.map((a) => a.id);
    expect([...ids].sort()).toEqual(ids);
  });
});

describe('generateBackgroundNpcs — count and provenance (Req 29.1)', () => {
  it('produces exactly the requested count, each from a civilian archetype', () => {
    const civilianIds = new Set(civilianArchetypes(content).map((a) => a.id));
    for (const count of [0, 1, 5, 8, 20]) {
      const { bg } = genNoise('count-seed', count);
      expect(bg.background.length).toBe(count);
      expect(Object.keys(bg.npcs).length).toBe(count);
      for (const { npc } of bg.background) {
        expect(npc.role).toBe('civilian');
        expect(civilianIds.has(npc.archetype)).toBe(true);
      }
    }
  });

  it('rejects a negative or non-integer count', () => {
    const c = core('reject-seed');
    const noise = createPrng(derive('reject-seed', NOISE_STREAM_BASE));
    expect(() =>
      generateBackgroundNpcs(noise, content, descriptors, c.city, c.orgs, -1),
    ).toThrow();
    expect(() =>
      generateBackgroundNpcs(noise, content, descriptors, c.city, c.orgs, 2.5),
    ).toThrow();
  });
});

describe('generateBackgroundNpcs — ids (Req 29.1)', () => {
  it('mints unique ids that cannot collide with Principal ids', () => {
    const { c, bg } = genNoise('id-seed', 12);
    const bgIds = Object.keys(bg.npcs);
    // Unique.
    expect(new Set(bgIds).size).toBe(bgIds.length);
    // Carry the bg- prefix.
    for (const id of bgIds) {
      expect(id.startsWith(`npc:${BACKGROUND_ID_PREFIX}-`)).toBe(true);
    }
    // Disjoint from every Principal id.
    const principalIds = new Set(Object.keys(c.principals.npcs));
    for (const id of bgIds) {
      expect(principalIds.has(id as NpcId)).toBe(false);
    }
  });
});

describe('generateBackgroundNpcs — schedules at public Locations (design step 1)', () => {
  it('places every scheduled slot at a public Location of the city', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 12 }),
        fc.integer({ min: 1, max: 16 }),
        (seed, count) => {
          const { c, bg } = genNoise(seed, count);
          const publics = publicLocIds(c.city);
          for (const { npc } of bg.background) {
            for (const entry of npc.schedule.entries) {
              // The Location exists in the city and is public.
              expect(c.city.locations[entry.loc]).toBeDefined();
              expect(publics.has(entry.loc)).toBe(true);
              // scheduledLocation agrees with the stored entry.
              expect(
                scheduledLocation(npc.schedule, entry.weekday, entry.phase),
              ).toBe(entry.loc);
            }
          }
        },
      ),
      { numRuns: 30 },
    );
  });
});

describe('generateBackgroundNpcs — local-facts Knowledge Slice (Req 29.1)', () => {
  it('holds only city/local propositions, no Plot/Cell facts, no false beliefs', () => {
    const { c, bg } = genNoise('slice-seed', 10);
    const orgIds = new Set<string>([
      STATION_ORG_ID,
      HOSTILE_ORG_ID,
      CELL_ORG_ID,
      ...Object.keys(c.orgs.orgs),
    ]);
    const principalIds = new Set<string>(Object.keys(c.principals.npcs));
    const bgIds = new Set<string>(Object.keys(bg.npcs));
    const publics = publicLocIds(c.city);

    for (const { npc, knowledge } of bg.background) {
      // Rumours (false beliefs) are task 6.3; this slice carries none.
      expect(knowledge.falseBeliefs).toEqual([]);
      // A scheduled civilian has a non-empty slice.
      if (npc.schedule.entries.length > 0) {
        expect(knowledge.known.length).toBeGreaterThan(0);
      }
      for (const p of knowledge.known) {
        // Every entity the slice names is a public Location or a Background NPC
        // — never an org, a Plot/Cell Principal, or a non-public Location.
        const entities = [p.subject];
        if (typeof p.object === 'string') {
          entities.push(p.object);
        }
        if (p.place !== undefined) {
          entities.push(p.place);
        }
        for (const e of entities) {
          expect(orgIds.has(e)).toBe(false);
          expect(principalIds.has(e)).toBe(false);
          if (e.startsWith('loc:')) {
            expect(publics.has(e)).toBe(true);
          } else {
            // Any person named is another Background NPC.
            expect(bgIds.has(e)).toBe(true);
          }
        }
      }
      // knownEntities is exactly the set the propositions name.
      for (const e of knowledge.knownEntities) {
        expect(orgIds.has(e)).toBe(false);
        expect(principalIds.has(e)).toBe(false);
      }
    }
  });
});

describe('generateBackgroundNpcs — allegiance (Req 29.1)', () => {
  it('gives every civilian a neutral/civilian allegiance serving no generated org', () => {
    const { c, bg } = genNoise('alleg-seed', 10);
    const genOrgIds = new Set<string>(Object.keys(c.orgs.orgs));
    for (const { npc } of bg.background) {
      // View-safe apparent allegiance is in the civilian band.
      expect(['neutral', 'unknown']).toContain(npc.apparentAllegiance);
      // Ground-truth allegiance serves none of the three generated orgs.
      const trueOrg = revealTruth(npc.trueAllegiance).org;
      expect(trueOrg).toBe(NEUTRAL_ORG_ID);
      expect(genOrgIds.has(trueOrg)).toBe(false);
      // No org binding on the NPC itself.
      expect(npc.org).toBeUndefined();
    }
  });
});

describe('generateBackgroundNpcs — determinism (Req 29.5, Property 1)', () => {
  it('produces an identical result for the same noise seed, city and content', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 12 }),
        fc.integer({ min: 0, max: 16 }),
        (seed, count) => {
          const a = genNoise(seed, count);
          const b = genNoise(seed, count);
          expect(JSON.stringify(b.bg)).toBe(JSON.stringify(a.bg));
        },
      ),
      { numRuns: 25 },
    );
  });

  it('is independent of the noise count where ids overlap (prefix is stable)', () => {
    // The i-th civilian's id is npc:bg-i regardless of total count, so a larger
    // run is a superset of a smaller one in ids (determinism of the id scheme).
    const small = genNoise('indep-seed', 4).bg;
    const large = genNoise('indep-seed', 9).bg;
    for (let i = 0; i < 4; i += 1) {
      expect(`npc:${BACKGROUND_ID_PREFIX}-${i}` in large.npcs).toBe(true);
      expect(`npc:${BACKGROUND_ID_PREFIX}-${i}` in small.npcs).toBe(true);
    }
  });
});
