/**
 * Tests for organisation and Principal-NPC generation (task 5.2; Requirements
 * 1.1, 1.3, 27.1).
 *
 * These load the real core pack, its `city.yaml` and `descriptors.yaml`,
 * generate a city, the three orgs and the Principal NPCs on one core PRNG
 * stream, and check the invariants the design fixes:
 *
 * - the three organisations exist with the right kinds and ids (Req 1.1);
 * - every required archetype role is represented — the four Cell roles, the two
 *   hostile officers, the Chief, 2–3 staff and 2–3 contacts (Req 1.1, 27.1);
 * - the roster size lands in the design's 10–14 Principal band (Req 1.1);
 * - every NPC has a true and apparent allegiance, a MICE profile within its
 *   archetype's ranges, a money need, a persona from the right culture pools, a
 *   descriptor, and a schedule bound to real city Locations (Req 1.3);
 * - true allegiances match roles and are reported for the Truth Store;
 * - a registry entry per NPC carries the persona name;
 * - and — the determinism that underpins Property 1 — the same seed and content
 *   produce an identical result.
 */

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  fittingPhrases,
  loadCityData,
  loadContent,
  loadDescriptorData,
  type Archetype,
  type CityData,
  type ContentSet,
  type DescriptorData,
} from '@tradecraft/content';

import { createPrng } from '../prng/prng.js';
import { revealTruth, type NpcId } from '../model/core.js';
import { generateCity } from './generate.js';
import { type City } from './city.js';
import {
  CELL_ORG_ID,
  CELL_ROLE_IDS,
  CHIEF_ROLE_ID,
  CONTACT_ROLE_IDS,
  generateOrgs,
  generatePrincipals,
  HOSTILE_ORG_ID,
  HOSTILE_ROLE_IDS,
  MAX_CONTACTS,
  MAX_STAFF,
  MIN_CONTACTS,
  MIN_DESCRIPTOR_DIFFERENCE,
  MIN_STAFF,
  moneyNeedOf,
  STAFF_ROLE_IDS,
  STATION_ORG_ID,
  type GeneratedPrincipals,
} from './principals.js';

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

/** Resolve an archetype by bare local id (registry keys are namespaced). */
function archetype(localId: string): Archetype {
  for (const [key, value] of content.archetypes) {
    if (key === localId || key.endsWith(`/${localId}`)) {
      return value;
    }
  }
  throw new Error(`no archetype ${localId}`);
}

interface Generated {
  readonly city: City;
  readonly orgs: ReturnType<typeof generateOrgs>;
  readonly principals: GeneratedPrincipals;
}

/** Run the full step-1→3 generation on one core stream for a seed. */
function gen(seed: string): Generated {
  const prng = createPrng(seed);
  const { city } = generateCity(prng, locationTypes, cityData);
  const orgs = generateOrgs(prng);
  const principals = generatePrincipals(prng, content, descriptors, city, orgs);
  return { city, orgs, principals };
}

describe('generateOrgs', () => {
  it('mints the Station, Hostile Service and Cell with canonical ids', () => {
    const { orgs } = gen('orgs-seed');
    expect(orgs.station.id).toBe(STATION_ORG_ID);
    expect(orgs.hostile.id).toBe(HOSTILE_ORG_ID);
    expect(orgs.cell.id).toBe(CELL_ORG_ID);
    expect(orgs.station.kind).toBe('station');
    expect(orgs.hostile.kind).toBe('hostile');
    expect(orgs.cell.kind).toBe('cell');
    expect(Object.keys(orgs.orgs).sort()).toEqual(
      [STATION_ORG_ID, HOSTILE_ORG_ID, CELL_ORG_ID].sort(),
    );
    // Each org projects its own allegiance category.
    expect(orgs.station.allegiance).toBe('station');
    expect(orgs.hostile.allegiance).toBe('hostile');
    expect(orgs.cell.allegiance).toBe('cell');
  });
});

describe('generatePrincipals — roster (Req 1.1, 27.1)', () => {
  it('represents every required archetype role', () => {
    const { principals } = gen('roster-seed');
    const roleOf = (id: NpcId): string => principals.npcs[id].archetype;

    // The four Cell roles, in order, leader first.
    expect(principals.cell.map(roleOf)).toEqual([...CELL_ROLE_IDS]);
    // Both hostile officers, resident first.
    expect(principals.hostile.map(roleOf)).toEqual([...HOSTILE_ROLE_IDS]);
    // The Chief of Station.
    expect(roleOf(principals.chief)).toBe(CHIEF_ROLE_ID);
    // 2–3 staff, drawn from the staff archetypes.
    expect(principals.staff.length).toBeGreaterThanOrEqual(MIN_STAFF);
    expect(principals.staff.length).toBeLessThanOrEqual(MAX_STAFF);
    for (const id of principals.staff) {
      expect(STAFF_ROLE_IDS).toContain(roleOf(id));
    }
    // 2–3 contacts, drawn from the contact archetypes. The police liaison is always one of them.
    expect(principals.contacts.length).toBeGreaterThanOrEqual(MIN_CONTACTS);
    expect(principals.contacts.length).toBeLessThanOrEqual(MAX_CONTACTS);
    for (const id of principals.contacts) {
      expect(CONTACT_ROLE_IDS).toContain(roleOf(id));
    }
    expect(principals.contacts.some((id) => roleOf(id).endsWith('police-liaison'))).toBe(true);
  });

  it('keeps one of the cell leader’s meetings outside the Soviet sector', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 12 }), (seed) => {
        const { city, principals } = gen(seed);
        const leader = principals.npcs[principals.cell[0]];
        const outside = leader.schedule.entries.some((entry) => {
          const place = city.locations[entry.loc];
          return city.districts[place.district]?.sector !== 'soviet';
        });
        expect(outside).toBe(true);
      }),
      { numRuns: 20 },
    );
  });

  it('produces 10–14 Principal NPCs (Req 1.1)', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 12 }), (seed) => {
        const { principals } = gen(seed);
        const count = Object.keys(principals.npcs).length;
        expect(count).toBeGreaterThanOrEqual(10);
        expect(count).toBeLessThanOrEqual(14);
      }),
      { numRuns: 40 },
    );
  });

  it('selects distinct staff and contact archetypes (no duplicates)', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 8 }), (seed) => {
        const { principals } = gen(seed);
        const staffArchetypes = principals.staff.map((id) => principals.npcs[id].archetype);
        expect(new Set(staffArchetypes).size).toBe(staffArchetypes.length);
        const contactArchetypes = principals.contacts.map(
          (id) => principals.npcs[id].archetype,
        );
        expect(new Set(contactArchetypes).size).toBe(contactArchetypes.length);
      }),
      { numRuns: 30 },
    );
  });

  it('gives every NPC a unique id', () => {
    const { principals } = gen('ids-seed');
    const ids = Object.keys(principals.npcs);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(id.startsWith('npc:')).toBe(true);
    }
  });
});

describe('generatePrincipals — allegiances (Req 1.3)', () => {
  it('sets true allegiance from role and reports it for the Truth Store', () => {
    const { principals, orgs } = gen('allegiance-seed');
    const expectOrg: Record<string, string> = {
      cell: orgs.cell.id,
      'hostile-officer': orgs.hostile.id,
      'station-staff': orgs.station.id,
      contact: orgs.station.id,
    };
    for (const npc of Object.values(principals.npcs)) {
      const trueOrg = revealTruth(npc.trueAllegiance).org;
      expect(trueOrg).toBe(expectOrg[npc.role]);
      expect(npc.org).toBe(expectOrg[npc.role]);
    }
    // Every NPC's allegiance is reported for the Truth Store, once each.
    expect(principals.allegiances.length).toBe(Object.keys(principals.npcs).length);
    for (const entry of principals.allegiances) {
      expect(principals.npcs[entry.npc]).toBeDefined();
      expect(entry.allegiance.org).toBe(revealTruth(principals.npcs[entry.npc].trueAllegiance).org);
    }
  });

  it('gives every NPC a valid apparent-allegiance category', () => {
    const { principals } = gen('apparent-seed');
    for (const npc of Object.values(principals.npcs)) {
      // Apparent allegiance is a cover posture, so it is drawn from the whole
      // view-safe vocabulary — not constrained to the archetype's
      // `allowedAllegiances`, which bound the *true* allegiance a role may
      // serve (a Cell archetype allows only `cell`, yet presents `neutral`).
      expect(['station', 'hostile', 'cell', 'neutral', 'unknown']).toContain(
        npc.apparentAllegiance,
      );
    }
  });

  it('derives apparent allegiance from the public post, not the covert role', () => {
    const { principals } = gen('apparent-map-seed');
    const apparentOf = (id: NpcId): string => principals.npcs[id].apparentAllegiance;

    // A Cell member is covert: it presents `neutral`, never `cell` (Property 33
    // — no Cell member presents as `cell`).
    for (const id of principals.cell) {
      expect(apparentOf(id)).toBe('neutral');
    }

    // Hostile officers present `hostile` only when their *primary* post is the
    // diplomatic mission — the embassy is the strict plurality of their
    // schedule. The resident keeps mission hours and reads `hostile`; the case
    // officer, under civilian cover, reads `neutral`.
    const archOf = (id: NpcId): Archetype => archetype(principals.npcs[id].archetype);
    // Task 1.6 moved the schedule to Tag Queries: a mission post is a slot whose
    // `at` query names `function:embassy`, and the mission is primary when it is
    // scheduled strictly more often than any other Tag Query (strict plurality).
    const MISSION_TAG = 'function:embassy';
    const missionIsPrimary = (id: NpcId): boolean => {
      const schedule = archOf(id).schedule;
      const mission = schedule.filter((slot) => slot.at.includes(MISSION_TAG)).length;
      if (mission === 0) return false;
      const counts = new Map<string, number>();
      for (const slot of schedule) {
        if (slot.at.includes(MISSION_TAG)) continue;
        const key = slot.at.join('\u0000');
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
      for (const count of counts.values()) {
        if (count >= mission) return false;
      }
      return true;
    };
    for (const id of principals.hostile) {
      expect(apparentOf(id)).toBe(missionIsPrimary(id) ? 'hostile' : 'neutral');
    }
    // At least one hostile officer (the resident) presents `hostile`, and at
    // least one (the case officer) presents `neutral`, so the two diverge.
    const hostileApparent = principals.hostile.map(apparentOf);
    expect(hostileApparent).toContain('hostile');
    expect(hostileApparent).toContain('neutral');

    // Station staff present `station`; contacts present `neutral`.
    expect(apparentOf(principals.chief)).toBe('station');
    for (const id of principals.staff) {
      expect(apparentOf(id)).toBe('station');
    }
    for (const id of principals.contacts) {
      expect(apparentOf(id)).toBe('neutral');
    }
  });
});

describe('generatePrincipals — MICE (Req 1.3)', () => {
  it('samples each MICE lever within the archetype range', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 8 }), (seed) => {
        const { principals } = gen(seed);
        for (const npc of Object.values(principals.npcs)) {
          const arch = archetype(npc.archetype);
          const mice = revealTruth(npc.mice);
          for (const lever of ['money', 'ideology', 'coercion', 'ego'] as const) {
            expect(mice[lever]).toBeGreaterThanOrEqual(arch.mice[lever].min);
            expect(mice[lever]).toBeLessThanOrEqual(arch.mice[lever].max);
          }
        }
      }),
      { numRuns: 30 },
    );
  });

  it('derives a money need from the money lever within bounds', () => {
    const { principals } = gen('money-seed');
    for (const npc of Object.values(principals.npcs)) {
      const mice = revealTruth(npc.mice);
      const need = revealTruth(npc.moneyNeed);
      expect(need).toBe(moneyNeedOf(mice.money));
      expect(need).toBeGreaterThanOrEqual(100);
      expect(need).toBeLessThanOrEqual(5000);
    }
  });

  it('keeps reliability, tradecraft and security in [0,1]', () => {
    const { principals } = gen('ratings-seed');
    for (const npc of Object.values(principals.npcs)) {
      for (const v of [
        revealTruth(npc.reliability),
        revealTruth(npc.tradecraft),
        revealTruth(npc.securityConsciousness),
      ]) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe('generatePrincipals — persona (Req 1.3)', () => {
  it('draws a fictional name from one of the archetype persona cultures', () => {
    const { principals } = gen('persona-seed');
    // Build a culture -> {given, family} index from the persona libraries.
    for (const npc of Object.values(principals.npcs)) {
      const arch = archetype(npc.archetype);
      // The persona library must be one the archetype references.
      const refMatches = arch.personaPools.some(
        (ref) => ref === npc.persona.library || ref.endsWith(`/${npc.persona.library}`),
      );
      expect(refMatches).toBe(true);

      // The given and family names must come from that library's pools.
      let library = content.personaLibraries.get(npc.persona.library);
      if (library === undefined) {
        for (const [key, value] of content.personaLibraries) {
          if (key.endsWith(`/${npc.persona.library}`)) {
            library = value;
            break;
          }
        }
      }
      expect(library).toBeDefined();
      // The name must come from a pool of the NPC's culture AND gender
      // (name pools are split by gender, Req 1.7).
      const pool = library!.namePools.find(
        (p) => p.culture === npc.persona.culture && p.gender === npc.persona.gender,
      );
      expect(pool).toBeDefined();
      expect(pool!.given).toContain(npc.persona.given);
      expect(pool!.family).toContain(npc.persona.family);
      expect(npc.persona.name).toBe(`${npc.persona.given} ${npc.persona.family}`);
      expect(npc.persona.openness).toBeGreaterThanOrEqual(0);
      expect(npc.persona.openness).toBeLessThanOrEqual(1);
    }
  });

  it('gives every NPC a persona gender of female or male (Req 1.7)', () => {
    const { principals } = gen('gender-seed');
    for (const npc of Object.values(principals.npcs)) {
      expect(['female', 'male']).toContain(npc.persona.gender);
    }
  });
});

describe('generatePrincipals — descriptor (Req 1.3, 1.7)', () => {
  it('wears one garment and at most one accessory', () => {
    const { principals } = gen('garment-seed');
    for (const npc of Object.values(principals.npcs)) {
      const gender = npc.persona.gender;
      const garments = npc.descriptor.phrases.filter((phrase) =>
        npc.descriptor.pools.some((poolId) => {
          const pool = descriptors.pools[poolId];
          return pool !== undefined && fittingPhrases(pool.garments, gender).includes(phrase);
        }),
      );
      const accessories = npc.descriptor.phrases.filter((phrase) =>
        npc.descriptor.pools.some((poolId) => {
          const pool = descriptors.pools[poolId];
          return pool !== undefined && fittingPhrases(pool.accessories, gender).includes(phrase);
        }),
      );
      expect(garments.length).toBeLessThanOrEqual(1);
      expect(accessories.length).toBeLessThanOrEqual(1);
      if (gender === 'female') {
        expect(npc.descriptor.phrases).not.toContain('clean-shaven');
      }
    }
  });

  it('builds a non-empty descriptor and records the archetype pools', () => {
    const { principals } = gen('descriptor-seed');
    for (const npc of Object.values(principals.npcs)) {
      const arch = archetype(npc.archetype);
      expect(npc.descriptor.summary.length).toBeGreaterThan(0);
      expect(npc.descriptor.pools).toEqual(arch.descriptorPools);
    }
  });

  it('every referenced pool resolves (no literal pool-id leakage)', () => {
    // The loader now guarantees every archetype pool exists, so a descriptor
    // phrase should never be a bare pool id dumped as text.
    const { principals } = gen('no-leak-seed');
    for (const npc of Object.values(principals.npcs)) {
      for (const poolId of npc.descriptor.pools) {
        expect(descriptors.pools[poolId]).toBeDefined();
        const leaked = poolId.replace(/-/g, ' ');
        expect(npc.descriptor.phrases).not.toContain(leaked);
      }
    }
  });

  it('draws only descriptor entries that fit the persona gender (Req 1.7)', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 8 }), (seed) => {
        const { principals } = gen(seed);
        for (const npc of Object.values(principals.npcs)) {
          const gender = npc.persona.gender;
          // Build the set of all phrases fitting the NPC's gender across the
          // shared blocks and every pool it draws from.
          const allowed = new Set<string>([
            ...fittingPhrases(descriptors.shared.build, gender),
            ...fittingPhrases(descriptors.shared.grooming, gender),
          ]);
          for (const poolId of npc.descriptor.pools) {
            const pool = descriptors.pools[poolId];
            if (pool === undefined) {
              continue;
            }
            for (const p of fittingPhrases(pool.garments, gender)) {
              allowed.add(p);
            }
            for (const p of fittingPhrases(pool.accessories, gender)) {
              allowed.add(p);
            }
          }
          for (const phrase of npc.descriptor.phrases) {
            expect(allowed.has(phrase)).toBe(true);
          }
        }
      }),
      { numRuns: 30 },
    );
  });

  it('makes every two Principals differ in at least two descriptor elements (Req 1.7)', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 10 }), (seed) => {
        const { principals } = gen(seed);
        const npcs = Object.values(principals.npcs);
        for (let i = 0; i < npcs.length; i += 1) {
          for (let j = i + 1; j < npcs.length; j += 1) {
            const a = new Set(npcs[i].descriptor.phrases);
            const b = new Set(npcs[j].descriptor.phrases);
            let diff = 0;
            for (const p of a) {
              if (!b.has(p)) diff += 1;
            }
            for (const p of b) {
              if (!a.has(p)) diff += 1;
            }
            expect(diff).toBeGreaterThanOrEqual(MIN_DESCRIPTOR_DIFFERENCE);
          }
        }
      }),
      { numRuns: 40 },
    );
  });
});

describe('generatePrincipals — name uniqueness (Req 1.7, 1.8)', () => {
  it('never repeats a given or family name across Principals, nor a full name', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 12 }), (seed) => {
        const { principals } = gen(seed);
        const npcs = Object.values(principals.npcs);
        const given = npcs.map((n) => n.persona.given);
        const family = npcs.map((n) => n.persona.family);
        const full = npcs.map((n) => n.persona.name);
        expect(new Set(given).size).toBe(given.length);
        expect(new Set(family).size).toBe(family.length);
        expect(new Set(full).size).toBe(full.length);
      }),
      { numRuns: 60 },
    );
  });
});

describe('generatePrincipals — schedule (Req 1.3)', () => {
  it('binds every schedule entry to a real city Location', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 8 }), (seed) => {
        const { city, principals } = gen(seed);
        for (const npc of Object.values(principals.npcs)) {
          for (const entry of npc.schedule.entries) {
            expect(city.locations[entry.loc]).toBeDefined();
            expect(entry.phase).toBeGreaterThanOrEqual(0);
            expect(entry.phase).toBeLessThanOrEqual(3);
            expect(entry.weekday).toBeGreaterThanOrEqual(0);
            expect(entry.weekday).toBeLessThanOrEqual(6);
          }
        }
      }),
      { numRuns: 30 },
    );
  });

  it('binds each scheduled Location through the slot Tag Query', () => {
    const { city, principals } = gen('schedule-type-seed');
    // Task 1.6 moved schedule binding to Tag Queries: a scheduled Location's
    // Effective Tags (its Location Type's Tags, since a slice Location has no
    // own Tags) satisfy one of the archetype's `at` queries, or its `fallback`,
    // or the public-meeting-spot floor the resolver falls back to.
    const typeTags = new Map<string, readonly string[]>();
    for (const [key, type] of content.locationTypes) {
      typeTags.set(key, type.tags);
      const slash = key.indexOf('/');
      if (slash !== -1) typeTags.set(key.slice(slash + 1), type.tags);
    }
    const satisfies = (tags: ReadonlySet<string>, q: readonly string[]): boolean =>
      q.every((t) => tags.has(t));
    for (const npc of Object.values(principals.npcs)) {
      const arch = archetype(npc.archetype);
      const queries: (readonly string[])[] = [
        ...arch.schedule.map((s) => s.at),
        ...(arch.fallback ? [arch.fallback] : []),
        ['function:meeting-spot'],
      ];
      for (const entry of npc.schedule.entries) {
        const loc = city.locations[entry.loc];
        const tags = new Set(typeTags.get(loc.type) ?? []);
        // The Location binds at least one of the archetype's queries (or the
        // meeting-spot floor the resolver uses when nothing else binds).
        const bound = queries.some((q) => satisfies(tags, q));
        expect(bound).toBe(true);
      }
    }
  });

  it('keeps at most one entry per (weekday, phase)', () => {
    const { principals } = gen('schedule-dedupe-seed');
    for (const npc of Object.values(principals.npcs)) {
      const keys = npc.schedule.entries.map((e) => `${e.weekday}:${e.phase}`);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });
});

describe('generatePrincipals — registry entries (Req 5.2)', () => {
  it('returns one entry per NPC carrying the persona name', () => {
    const { principals } = gen('registry-seed');
    expect(principals.registryEntries.length).toBe(
      Object.keys(principals.npcs).length,
    );
    for (const entry of principals.registryEntries) {
      const npc = principals.npcs[entry.id as NpcId];
      expect(npc).toBeDefined();
      expect(entry.canonicalName).toBe(npc.persona.name);
      // The descriptor alias is generic (does not gate the Leak Guard).
      for (const alias of entry.aliases) {
        expect(alias.distinctive).toBe(false);
      }
    }
  });
});

describe('determinism (underpins Property 1)', () => {
  it('produces an identical result for the same seed and content', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 16 }), (seed) => {
        const a = gen(seed);
        const b = gen(seed);
        expect(JSON.stringify(a.principals)).toEqual(JSON.stringify(b.principals));
        expect(JSON.stringify(a.orgs)).toEqual(JSON.stringify(b.orgs));
      }),
      { numRuns: 40 },
    );
  });

  it('produces different rosters for different seeds (not a constant)', () => {
    const a = JSON.stringify(gen('seed-alpha').principals);
    const b = JSON.stringify(gen('seed-beta').principals);
    expect(a).not.toEqual(b);
  });
});
