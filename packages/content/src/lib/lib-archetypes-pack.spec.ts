/**
 * The Library Pack load test for `lib-archetypes` (content-expansion task 8.3).
 *
 * Loads the shipped `lib-archetypes` Library Pack together with the core pack
 * from disk through `loadContent`, exactly as a scenario drawing its NPC roster
 * from these archetypes would, and asserts the load succeeds with no
 * ContentErrors. A clean load exercises the whole archetype pipeline the task
 * depends on: schema validation (ArchetypeSchema), the Tag check (every
 * archetype carries a vocabulary Tag whose facet applies to the kind), and the
 * persona/descriptor cross-reference resolution (every `personaPools` /
 * `descriptorPools` ref resolves to a core pool — this pack ships none of its
 * own, so each ref is `core/...` namespaced).
 *
 * It then confirms the merged Content Set carries the roster this task authored
 * (Req 6.2, 11.5): at least 40 civilian archetypes plus period variants of all
 * four slice role archetypes (cell, hostile-officer, station-staff, contact),
 * and that each archetype is well-formed — a role-matching `role:*` Tag, MICE
 * ranges, a wariness band, a Tag Query schedule and a `fallback` Tag Query.
 */

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  loadContent,
  type Archetype,
  type ContentSet,
  type LoadResult,
} from '../index.js';

const PACKS_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'packs',
);
const CORE_DIR = join(PACKS_DIR, 'core');
const ARCHETYPES_DIR = join(PACKS_DIR, 'lib-archetypes');

/** Load core + the Library Pack, surfacing every ContentError in the message. */
function loadArchetypePack(): ContentSet {
  const result: LoadResult<ContentSet> = loadContent(
    [CORE_DIR, ARCHETYPES_DIR],
    ['core', 'lib-archetypes'],
  );
  if (!result.ok) {
    throw new Error(
      `lib-archetypes failed to load with ${result.errors.length} error(s):\n${result.errors
        .map((e) => `  ${e.pack}/${e.file} ${e.path}: ${e.message}`)
        .join('\n')}`,
    );
  }
  return result.value;
}

/** Every archetype this pack owns (its id is namespaced `lib-archetypes/...`). */
function packArchetypes(set: ContentSet): Archetype[] {
  const out: Archetype[] = [];
  for (const [id, arch] of set.archetypes) {
    if (id.startsWith('lib-archetypes/')) {
      out.push(arch);
    }
  }
  return out;
}

const EXPECTED_CIVILIAN_SAMPLE = [
  'lib-archetypes/lib-dockworker',
  'lib-archetypes/lib-tram-conductor',
  'lib-archetypes/lib-cafe-waiter',
  'lib-archetypes/lib-emigre-bookseller',
  'lib-archetypes/lib-wire-service-stringer',
  'lib-archetypes/lib-hotel-concierge',
  'lib-archetypes/lib-ministry-clerk',
  'lib-archetypes/lib-black-market-trader',
  'lib-archetypes/lib-university-student',
  'lib-archetypes/lib-night-porter',
] as const;

const EXPECTED_ROLE_VARIANTS: Readonly<Record<Archetype['role'], string>> = {
  cell: 'lib-archetypes/lib-cell-quartermaster',
  'hostile-officer': 'lib-archetypes/lib-hostile-illegal',
  'station-staff': 'lib-archetypes/lib-station-reports-officer',
  contact: 'lib-archetypes/lib-contact-smuggler',
  civilian: 'lib-archetypes/lib-cafe-waiter',
};

describe('lib-archetypes Library Pack', () => {
  it('loads cleanly with the core pack (no ContentErrors)', () => {
    const result = loadContent(
      [CORE_DIR, ARCHETYPES_DIR],
      ['core', 'lib-archetypes'],
    );
    expect(result.ok).toBe(true);
  });

  it('ships at least 40 civilian archetypes (Req 11.5)', () => {
    const set = loadArchetypePack();
    const civilians = packArchetypes(set).filter((a) => a.role === 'civilian');
    expect(civilians.length).toBeGreaterThanOrEqual(40);
  });

  it('includes the named civilian trades the task calls for', () => {
    const set = loadArchetypePack();
    for (const id of EXPECTED_CIVILIAN_SAMPLE) {
      expect(set.archetypes.has(id), `missing archetype ${id}`).toBe(true);
    }
  });

  it('ships a period variant of every slice role archetype (Req 6.2)', () => {
    const set = loadArchetypePack();
    const mine = packArchetypes(set);
    for (const role of ['cell', 'hostile-officer', 'station-staff', 'contact'] as const) {
      const variants = mine.filter((a) => a.role === role);
      expect(variants.length, `no ${role} variant`).toBeGreaterThanOrEqual(1);
      expect(set.archetypes.has(EXPECTED_ROLE_VARIANTS[role])).toBe(true);
    }
  });

  it('every archetype carries a role-matching vocabulary Tag', () => {
    const set = loadArchetypePack();
    for (const arch of packArchetypes(set)) {
      expect(arch.tags.length, `${arch.id} tags`).toBeGreaterThanOrEqual(1);
      expect(arch.tags, `${arch.id} role tag`).toContain(`role:${arch.role}`);
    }
  });

  it('every archetype gives MICE ranges, a wariness band and a schedule with a fallback', () => {
    const set = loadArchetypePack();
    for (const arch of packArchetypes(set)) {
      for (const lever of ['money', 'ideology', 'coercion', 'ego'] as const) {
        const r = arch.mice[lever];
        expect(r.min, `${arch.id} ${lever} min`).toBeGreaterThanOrEqual(0);
        expect(r.max, `${arch.id} ${lever} max`).toBeLessThanOrEqual(1);
        expect(r.min, `${arch.id} ${lever} order`).toBeLessThanOrEqual(r.max);
      }
      expect(arch.wariness.min, `${arch.id} wariness`).toBeGreaterThanOrEqual(0);
      expect(arch.wariness.max, `${arch.id} wariness`).toBeLessThanOrEqual(1);
      expect(arch.schedule.length, `${arch.id} schedule`).toBeGreaterThanOrEqual(1);
      for (const slot of arch.schedule) {
        expect(slot.at.length, `${arch.id} schedule.at`).toBeGreaterThanOrEqual(1);
      }
      expect(arch.fallback, `${arch.id} fallback`).toBeDefined();
      expect((arch.fallback ?? []).length, `${arch.id} fallback`).toBeGreaterThanOrEqual(1);
    }
  });

  it('references only core persona and descriptor pools (no bare, unresolved refs)', () => {
    const set = loadArchetypePack();
    for (const arch of packArchetypes(set)) {
      for (const pool of [...arch.personaPools, ...arch.descriptorPools]) {
        expect(pool.startsWith('core/'), `${arch.id} ref ${pool}`).toBe(true);
      }
    }
  });
});
