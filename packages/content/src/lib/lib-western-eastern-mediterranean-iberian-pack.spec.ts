/**
 * The Library Pack load test for `lib-western`, `lib-eastern-mediterranean` and
 * `lib-iberian` (content-expansion task 8.2).
 *
 * Loads the three shipped Library Packs together with the core pack from disk
 * through `loadContent`, exactly as a scenario drawing NPC names from these
 * groups would, and asserts the load succeeds with no ContentErrors. It then
 * confirms the merged Content Set carries the ten Culture Groups this task
 * authored (American English, British English, French; Turkish, Istanbul Greek,
 * Armenian, Sephardic (Ladino-speaking), Levantine; Portuguese and Spanish),
 * each with its Naming Rule, voice traits, mannerisms and Year-ranged persona
 * backgrounds (Req 6.1, 7.1).
 *
 * It also enforces the Quantity Target (Req 11.4 / the CE-QUANTITY Lint Rule):
 * every group has at least 100 given names, at least 100 family names and at
 * least 300 distinct names in total, with no duplicate within a Name Pool. It
 * checks the Iberian second-surname requirement: Portuguese and Spanish carry a
 * `parts.family2` Naming Rule whose display pattern renders a second surname,
 * with plain (invariant) family strings (Req 11.4, 11.6).
 *
 * Finally it checks the task-level persona-background floor: across the groups
 * of task 8.1 (`lib-central-europe` + `lib-russian`) and task 8.2 (these three
 * packs) together, the shipped Culture Groups supply at least 200 persona
 * backgrounds (Req 11.6).
 */

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  loadContent,
  type ContentSet,
  type CultureGroup,
  type LoadResult,
} from '../index.js';

const PACKS_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'packs',
);
const CORE_DIR = join(PACKS_DIR, 'core');
const WESTERN_DIR = join(PACKS_DIR, 'lib-western');
const EASTMED_DIR = join(PACKS_DIR, 'lib-eastern-mediterranean');
const IBERIAN_DIR = join(PACKS_DIR, 'lib-iberian');

/** The pack dirs and ids this test loads (core first, then the three libraries). */
const DIRS = [CORE_DIR, WESTERN_DIR, EASTMED_DIR, IBERIAN_DIR];
const IDS = ['core', 'lib-western', 'lib-eastern-mediterranean', 'lib-iberian'];

/** Load core + the three Library Packs, surfacing every ContentError in the message. */
function loadLibraryPacks(): ContentSet {
  const result: LoadResult<ContentSet> = loadContent(DIRS, IDS);
  if (!result.ok) {
    throw new Error(
      `library packs failed to load with ${result.errors.length} error(s):\n${result.errors
        .map((e) => `  ${e.pack}/${e.file} ${e.path}: ${e.message}`)
        .join('\n')}`,
    );
  }
  return result.value;
}

/** The namespaced ids each Culture Group is keyed by in the Content Set. */
const WESTERN_IDS = [
  'lib-western/american-english',
  'lib-western/british-english',
  'lib-western/french',
] as const;
const EASTMED_IDS = [
  'lib-eastern-mediterranean/turkish',
  'lib-eastern-mediterranean/istanbul-greek',
  'lib-eastern-mediterranean/armenian',
  'lib-eastern-mediterranean/sephardic',
  'lib-eastern-mediterranean/levantine',
] as const;
const IBERIAN_IDS = ['lib-iberian/portuguese', 'lib-iberian/spanish'] as const;
const ALL_IDS = [...WESTERN_IDS, ...EASTMED_IDS, ...IBERIAN_IDS] as const;

/** The display string of a family name, whichever gendered form it carries. */
function familyForms(f: CultureGroup['family'][number]): string[] {
  return typeof f === 'string' ? [f] : [f.m, f.f];
}

/**
 * The Culture Group's name count, matching the CE-QUANTITY Lint Rule: the given
 * names of both genders plus one count per family entry (a gendered pair counts
 * once). This is the authoritative Quantity Target the release linter enforces
 * (require 300 total, 100 given, 100 family).
 */
function nameCount(group: CultureGroup): number {
  return group.given.f.length + group.given.m.length + group.family.length;
}

describe('lib-western + lib-eastern-mediterranean + lib-iberian Library Packs', () => {
  it('loads cleanly with the core pack (no ContentErrors)', () => {
    const result = loadContent(DIRS, IDS);
    expect(result.ok).toBe(true);
  });

  it('registers all ten Culture Groups with names and languages', () => {
    const set = loadLibraryPacks();
    for (const id of ALL_IDS) {
      const group = set.cultureGroups[id];
      expect(group, `missing culture group ${id}`).toBeDefined();
      expect(group.name.length).toBeGreaterThan(0);
      expect(group.languages.length).toBeGreaterThanOrEqual(1);
    }
    expect(set.cultureGroups['lib-western/american-english'].name).toBe(
      'American English',
    );
    expect(set.cultureGroups['lib-western/british-english'].name).toBe(
      'British English',
    );
    expect(set.cultureGroups['lib-eastern-mediterranean/sephardic'].name).toBe(
      'Sephardic (Ladino-speaking)',
    );
    expect(set.cultureGroups['lib-iberian/portuguese'].name).toBe('Portuguese');
  });

  it('every group meets the Quantity Target (Req 11.4: >=100 given, >=100 family, >=300 total)', () => {
    const set = loadLibraryPacks();
    for (const id of ALL_IDS) {
      const group = set.cultureGroups[id];
      const givenCount = group.given.f.length + group.given.m.length;
      expect(givenCount, `${id} given`).toBeGreaterThanOrEqual(100);
      expect(group.family.length, `${id} family`).toBeGreaterThanOrEqual(100);
      expect(nameCount(group), `${id} total names`).toBeGreaterThanOrEqual(300);
    }
  });

  it('has no duplicate name within any single Name Pool (CE-NAMEDUP)', () => {
    const set = loadLibraryPacks();
    for (const id of ALL_IDS) {
      const group = set.cultureGroups[id];
      expect(new Set(group.given.f).size, `${id} given.f`).toBe(
        group.given.f.length,
      );
      expect(new Set(group.given.m).size, `${id} given.m`).toBe(
        group.given.m.length,
      );
      const familyKeys = group.family.map((f) => familyForms(f).join('/'));
      expect(new Set(familyKeys).size, `${id} family`).toBe(familyKeys.length);
    }
  });

  it('the Iberian groups carry a second-surname Naming Rule with invariant family strings', () => {
    const set = loadLibraryPacks();
    for (const id of IBERIAN_IDS) {
      const group = set.cultureGroups[id];
      expect(group.naming.parts?.family2, `${id} parts.family2`).toBe(true);
      expect(group.naming.display, `${id} display`).toContain('{family2}');
      // Iberian surnames are invariant: every family entry is a plain string.
      for (const fam of group.family) {
        expect(typeof fam, `${id} family entry`).toBe('string');
      }
    }
    expect(set.cultureGroups['lib-iberian/spanish'].family).toContain('García');
    expect(set.cultureGroups['lib-iberian/portuguese'].family).toContain(
      'Silva',
    );
  });

  it('the non-Iberian groups use plain {given} {family} naming', () => {
    const set = loadLibraryPacks();
    for (const id of [...WESTERN_IDS, ...EASTMED_IDS]) {
      const group = set.cultureGroups[id];
      expect(group.naming.parts?.family2, `${id} family2`).not.toBe(true);
      expect(
        group.naming.parts?.patronymic,
        `${id} patronymic`,
      ).toBeUndefined();
      expect(group.naming.display, `${id} display`).toBe('{given} {family}');
    }
  });

  it('every group supplies voice traits, mannerisms and persona backgrounds', () => {
    const set = loadLibraryPacks();
    for (const id of ALL_IDS) {
      const group = set.cultureGroups[id];
      expect(
        group.voiceTraits.length,
        `${id} voiceTraits`,
      ).toBeGreaterThanOrEqual(1);
      expect(
        group.mannerisms.length,
        `${id} mannerisms`,
      ).toBeGreaterThanOrEqual(1);
      expect(
        group.backgrounds.length,
        `${id} backgrounds`,
      ).toBeGreaterThanOrEqual(1);
    }
  });

  it('tasks 8.1 and 8.2 together supply at least 200 persona backgrounds (Req 11.6)', () => {
    // Load every shipped Library Pack (8.1 + 8.2) and count persona backgrounds.
    const centralDir = join(PACKS_DIR, 'lib-central-europe');
    const russianDir = join(PACKS_DIR, 'lib-russian');
    const result = loadContent(
      [CORE_DIR, centralDir, russianDir, WESTERN_DIR, EASTMED_DIR, IBERIAN_DIR],
      [
        'core',
        'lib-central-europe',
        'lib-russian',
        'lib-western',
        'lib-eastern-mediterranean',
        'lib-iberian',
      ],
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const total = Object.values(result.value.cultureGroups).reduce(
      (sum, group) => sum + group.backgrounds.length,
      0,
    );
    expect(total).toBeGreaterThanOrEqual(200);
  });
});
