/**
 * The Library Pack load test for `lib-central-europe` and `lib-russian`
 * (content-expansion task 8.1).
 *
 * Loads the two shipped Library Packs together with the core pack from disk
 * through `loadContent`, exactly as a scenario drawing NPC names from these
 * groups would, and asserts the load succeeds with no ContentErrors. It then
 * confirms the merged Content Set carries the six Culture Groups this task
 * authored (Austrian German, German (Berlin), Czech, Hungarian, Polish and
 * Russian), each with its Naming Rule, voice traits, mannerisms and Year-ranged
 * persona backgrounds (Req 6.1, 7.1).
 *
 * It also enforces the Quantity Target (Req 11.4 / the CE-QUANTITY Lint Rule):
 * every group has at least 100 given names, at least 100 family names and at
 * least 300 distinct names in total, with no duplicate within a Name Pool. It
 * checks the gendered-family-form and patronymic requirements: Czech, Polish
 * and Russian carry gendered surname pairs, and the Russian Naming Rule carries
 * the gendered patronymic endings (Req 11.4, 11.6).
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
const CENTRAL_DIR = join(PACKS_DIR, 'lib-central-europe');
const RUSSIAN_DIR = join(PACKS_DIR, 'lib-russian');

/** Load core + the two Library Packs, surfacing every ContentError in the message. */
function loadLibraryPacks(): ContentSet {
  const result: LoadResult<ContentSet> = loadContent(
    [CORE_DIR, CENTRAL_DIR, RUSSIAN_DIR],
    ['core', 'lib-central-europe', 'lib-russian'],
  );
  if (!result.ok) {
    throw new Error(
      `library packs failed to load with ${result.errors.length} error(s):\n${result.errors
        .map((e) => `  ${e.pack}/${e.file} ${e.path}: ${e.message}`)
        .join('\n')}`,
    );
  }
  return result.value;
}

/** The namespaced id a Culture Group is keyed by in the Content Set. */
const CENTRAL_IDS = [
  'lib-central-europe/austrian-german',
  'lib-central-europe/german-berlin',
  'lib-central-europe/czech',
  'lib-central-europe/hungarian',
  'lib-central-europe/polish',
] as const;
const RUSSIAN_ID = 'lib-russian/russian';
const ALL_IDS = [...CENTRAL_IDS, RUSSIAN_ID] as const;

/** The display string of a family name, whichever gendered form it carries. */
function familyForms(f: CultureGroup['family'][number]): string[] {
  return typeof f === 'string' ? [f] : [f.m, f.f];
}

/** Every distinct name a group offers (given of both genders, plus families). */
function distinctNames(group: CultureGroup): Set<string> {
  const names = new Set<string>();
  for (const n of group.given.f) names.add(n);
  for (const n of group.given.m) names.add(n);
  for (const fam of group.family) {
    for (const form of familyForms(fam)) names.add(form);
  }
  return names;
}

describe('lib-central-europe + lib-russian Library Packs', () => {
  it('loads cleanly with the core pack (no ContentErrors)', () => {
    const result = loadContent(
      [CORE_DIR, CENTRAL_DIR, RUSSIAN_DIR],
      ['core', 'lib-central-europe', 'lib-russian'],
    );
    expect(result.ok).toBe(true);
  });

  it('registers all six Culture Groups with names and languages', () => {
    const set = loadLibraryPacks();
    for (const id of ALL_IDS) {
      const group = set.cultureGroups[id];
      expect(group, `missing culture group ${id}`).toBeDefined();
      expect(group.name.length).toBeGreaterThan(0);
      expect(group.languages.length).toBeGreaterThanOrEqual(1);
    }
    expect(set.cultureGroups['lib-central-europe/austrian-german'].name).toBe(
      'Austrian German',
    );
    expect(set.cultureGroups['lib-central-europe/german-berlin'].name).toBe(
      'German (Berlin)',
    );
    expect(set.cultureGroups[RUSSIAN_ID].name).toBe('Russian');
  });

  it('every group meets the Quantity Target (Req 11.4: >=100 given, >=100 family, >=300 total)', () => {
    const set = loadLibraryPacks();
    for (const id of ALL_IDS) {
      const group = set.cultureGroups[id];
      const givenCount = group.given.f.length + group.given.m.length;
      expect(givenCount, `${id} given`).toBeGreaterThanOrEqual(100);
      expect(group.family.length, `${id} family`).toBeGreaterThanOrEqual(100);
      expect(distinctNames(group).size, `${id} distinct total`).toBeGreaterThanOrEqual(
        300,
      );
    }
  });

  it('has no duplicate name within any single Name Pool (CE-NAMEDUP)', () => {
    const set = loadLibraryPacks();
    for (const id of ALL_IDS) {
      const group = set.cultureGroups[id];
      expect(new Set(group.given.f).size, `${id} given.f`).toBe(group.given.f.length);
      expect(new Set(group.given.m).size, `${id} given.m`).toBe(group.given.m.length);
      const familyKeys = group.family.map((f) => familyForms(f).join('/'));
      expect(new Set(familyKeys).size, `${id} family`).toBe(familyKeys.length);
    }
  });

  it('Czech and Polish carry gendered family forms', () => {
    const set = loadLibraryPacks();
    const czech = set.cultureGroups['lib-central-europe/czech'];
    expect(czech.family).toContainEqual({ m: 'Novák', f: 'Nováková' });
    const polish = set.cultureGroups['lib-central-europe/polish'];
    expect(polish.family).toContainEqual({ m: 'Kowalski', f: 'Kowalska' });
  });

  it('Russian carries gendered family forms and a gendered patronymic Naming Rule', () => {
    const set = loadLibraryPacks();
    const russian = set.cultureGroups[RUSSIAN_ID];
    expect(russian.family).toContainEqual({ m: 'Petrov', f: 'Petrova' });
    expect(russian.naming.parts?.patronymic).toEqual({ m: 'ovich', f: 'ovna' });
    expect(russian.naming.display).toContain('{patronymic}');
  });

  it('every group supplies voice traits, mannerisms and persona backgrounds', () => {
    const set = loadLibraryPacks();
    for (const id of ALL_IDS) {
      const group = set.cultureGroups[id];
      expect(group.voiceTraits.length, `${id} voiceTraits`).toBeGreaterThanOrEqual(1);
      expect(group.mannerisms.length, `${id} mannerisms`).toBeGreaterThanOrEqual(1);
      expect(group.backgrounds.length, `${id} backgrounds`).toBeGreaterThanOrEqual(1);
    }
  });
});
