/**
 * Tests for NPC naming (content-expansion task 3.4): `nameNpc`,
 * `normaliseName`, `normaliseBlocklist`.
 *
 * A unit suite pins the specific behaviours the design fixes — the gendered
 * given/family draw, the Russian patronymic and Iberian second surname, the
 * `display`/`formal` rendering, blocklist and used-name rejection, and the
 * deterministic enumeration fallback. A fast-check property covers naming
 * soundness across many worlds (Property 9 feeds Req 7.1–7.4): every full name
 * is distinct, none matches the blocklist, and the same seed names the same
 * world.
 */

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import type { CultureGroup } from '@tradecraft/content';

import { createPrng } from '../prng/prng.js';
import {
  EMPTY_BLOCKLIST,
  MAX_NAME_REJECTIONS,
  nameNpc,
  normaliseBlocklist,
  normaliseName,
  type CultureWeights,
  type NameGender,
  type NormalisedBlocklist,
} from './names.js';

// --- fixtures --------------------------------------------------------------

/** A plain German-style group: `{given} {family}`, no gendered family forms. */
function germanGroup(id = 'lib/german'): CultureGroup {
  return {
    id,
    name: 'German',
    languages: ['de'],
    naming: { display: '{given} {family}', formal: '{honorific} {family}' },
    given: {
      f: ['Anna', 'Maria', 'Elke', 'Ingrid'],
      m: ['Hans', 'Klaus', 'Werner', 'Dieter'],
    },
    family: ['Müller', 'Schmidt', 'Weber', 'Lang'],
    voiceTraits: [],
    mannerisms: [],
    backgrounds: [],
  };
}

/** A Czech-style group with gendered family forms (Novák / Nováková). */
function czechGroup(id = 'lib/czech'): CultureGroup {
  return {
    id,
    name: 'Czech',
    languages: ['cs'],
    naming: { display: '{given} {family}', formal: '{honorific} {family}' },
    given: { f: ['Eva', 'Jana'], m: ['Jan', 'Petr'] },
    family: [
      { m: 'Novák', f: 'Nováková' },
      { m: 'Svoboda', f: 'Svobodová' },
    ],
    voiceTraits: [],
    mannerisms: [],
    backgrounds: [],
  };
}

/** A Russian-style group with a gendered patronymic. */
function russianGroup(id = 'lib/russian'): CultureGroup {
  return {
    id,
    name: 'Russian',
    languages: ['ru'],
    naming: {
      display: '{given} {patronymic} {family}',
      formal: '{given} {patronymic}',
      parts: { patronymic: { m: 'ovich', f: 'ovna' } },
    },
    given: { f: ['Olga', 'Nina'], m: ['Ivan', 'Boris'] },
    family: [
      { m: 'Volkov', f: 'Volkova' },
      { m: 'Orlov', f: 'Orlova' },
    ],
    voiceTraits: [],
    mannerisms: [],
    backgrounds: [],
  };
}

/** An Iberian-style group with a second surname. */
function iberianGroup(id = 'lib/spanish'): CultureGroup {
  return {
    id,
    name: 'Spanish',
    languages: ['es'],
    naming: {
      display: '{given} {family} {family2}',
      formal: '{honorific} {family}',
      parts: { family2: true },
    },
    given: { f: ['Carmen', 'Lucía'], m: ['José', 'Carlos'] },
    family: ['García', 'Fernández', 'López'],
    voiceTraits: [],
    mannerisms: [],
    backgrounds: [],
  };
}

function weightsFor(groups: readonly CultureGroup[]): CultureWeights {
  return groups.map((g) => ({ group: g.id, weight: 1 }));
}

// --- normalisation ---------------------------------------------------------

describe('normaliseName', () => {
  it('case-folds, diacritic-folds and collapses whitespace', () => {
    expect(normaliseName('José  María')).toBe('jose maria');
    expect(normaliseName('  Nováková ')).toBe('novakova');
    expect(normaliseName('Hans\tLang')).toBe('hans lang');
  });
});

describe('normaliseBlocklist', () => {
  it('normalises full names and the surname of familyOnly entries', () => {
    const bl = normaliseBlocklist([
      { name: 'Josef Stalin' },
      { name: 'Konrad Adenauer', familyOnly: true },
    ]);
    expect(bl.fullNames.has('josef stalin')).toBe(true);
    expect(bl.fullNames.has('konrad adenauer')).toBe(true);
    expect(bl.familyNames.has('adenauer')).toBe(true);
    expect(bl.familyNames.has('stalin')).toBe(false);
  });
});

// --- rendering -------------------------------------------------------------

describe('nameNpc rendering', () => {
  it('renders a plain display name from the given and family pools', () => {
    const g = germanGroup();
    const result = nameNpc(
      [g],
      weightsFor([g]),
      'f',
      new Set(),
      EMPTY_BLOCKLIST,
      createPrng('seed-de'),
    );
    expect(result.culture).toBe('lib/german');
    const [given, family] = result.name.split(' ');
    expect(g.given.f).toContain(given);
    expect(g.family).toContain(family);
    // The formal pattern leaves the Locale-supplied {honorific} slot in place.
    expect(result.formal.startsWith('{honorific} ')).toBe(true);
    expect(g.family).toContain(result.formal.replace('{honorific} ', ''));
  });

  it('uses the gendered family form matching the drawn gender', () => {
    const g = czechGroup();
    // A feminine draw must take a feminine surname (…ová); masculine the bare.
    for (const [gender, suffix] of [
      ['f', 'ová'],
      ['m', ''],
    ] as const) {
      for (let i = 0; i < 20; i += 1) {
        const result = nameNpc(
          [g],
          weightsFor([g]),
          gender as NameGender,
          new Set(),
          EMPTY_BLOCKLIST,
          createPrng(`cz-${gender}-${i}`),
        );
        const family = result.name.split(' ')[1];
        if (gender === 'f') {
          expect(family.endsWith('ová')).toBe(true);
        } else {
          expect(suffix).toBe('');
          expect(family.endsWith('ová')).toBe(false);
        }
      }
    }
  });

  it('renders a Russian patronymic with the gendered ending', () => {
    const g = russianGroup();
    const fem = nameNpc([g], weightsFor([g]), 'f', new Set(), EMPTY_BLOCKLIST, createPrng('ru-f'));
    const masc = nameNpc([g], weightsFor([g]), 'm', new Set(), EMPTY_BLOCKLIST, createPrng('ru-m'));
    const femPatronymic = fem.name.split(' ')[1];
    const mascPatronymic = masc.name.split(' ')[1];
    expect(femPatronymic.endsWith('ovna')).toBe(true);
    expect(mascPatronymic.endsWith('ovich')).toBe(true);
    // The patronymic is built on a masculine given name (the father's).
    expect(g.given.m.some((m) => femPatronymic.startsWith(m))).toBe(true);
  });

  it('renders an Iberian second surname', () => {
    const g = iberianGroup();
    const result = nameNpc([g], weightsFor([g]), 'm', new Set(), EMPTY_BLOCKLIST, createPrng('es-1'));
    const parts = result.name.split(' ');
    expect(parts).toHaveLength(3);
    expect(g.given.m).toContain(parts[0]);
    expect(g.family).toContain(parts[1]);
    expect(g.family).toContain(parts[2]);
  });
});

// --- weighting -------------------------------------------------------------

describe('nameNpc culture draw', () => {
  it('only draws groups with positive weight', () => {
    const a = germanGroup('lib/a');
    const b = czechGroup('lib/b');
    const weights: CultureWeights = [
      { group: 'lib/a', weight: 0 },
      { group: 'lib/b', weight: 5 },
    ];
    for (let i = 0; i < 30; i += 1) {
      const result = nameNpc([a, b], weights, 'm', new Set(), EMPTY_BLOCKLIST, createPrng(`w-${i}`));
      expect(result.culture).toBe('lib/b');
    }
  });
});

// --- rejection -------------------------------------------------------------

describe('nameNpc rejection', () => {
  it('redraws a name already in the used set', () => {
    // A group whose combination space (10 × 10 = 100) comfortably exceeds the
    // number of names drawn, so distinctness is genuinely guaranteed by the
    // pools (the real content meets the Req 11 size targets).
    const g: CultureGroup = {
      id: 'lib/big',
      name: 'Big',
      languages: ['x'],
      naming: { display: '{given} {family}', formal: '{family}' },
      given: {
        f: Array.from({ length: 10 }, (_, i) => `Fem${i}`),
        m: Array.from({ length: 10 }, (_, i) => `Mas${i}`),
      },
      family: Array.from({ length: 10 }, (_, i) => `Fam${i}`),
      voiceTraits: [],
      mannerisms: [],
      backgrounds: [],
    };
    const used = new Set<string>();
    // Draw across one stream so each successive name sees the growing used set.
    const rng = createPrng('used-redraw');
    for (let i = 0; i < 20; i += 1) {
      const next = nameNpc([g], weightsFor([g]), 'f', used, EMPTY_BLOCKLIST, rng);
      expect(used.has(normaliseName(next.name))).toBe(false);
      used.add(normaliseName(next.name));
    }
    expect(used.size).toBe(20);
  });

  it('never returns a blocklisted full name', () => {
    const g = germanGroup();
    // Blocklist every possible full name except one combination so the draw is
    // forced onto the single free name through the enumeration fallback.
    const all: string[] = [];
    for (const given of g.given.m) {
      for (const family of g.family) {
        all.push(`${given} ${family}`);
      }
    }
    const free = all[0];
    const blocklist: NormalisedBlocklist = normaliseBlocklist(
      all.slice(1).map((name) => ({ name })),
    );
    const result = nameNpc([g], weightsFor([g]), 'm', new Set(), blocklist, createPrng('bl-1'));
    expect(normaliseName(result.name)).toBe(normaliseName(free));
  });

  it('rejects a familyOnly surname standing alone', () => {
    const g = germanGroup();
    // Block the surname "Lang" family-only; no returned name may use it.
    const blocklist = normaliseBlocklist([{ name: 'Something Lang', familyOnly: true }]);
    for (let i = 0; i < 40; i += 1) {
      const result = nameNpc([g], weightsFor([g]), 'm', new Set(), blocklist, createPrng(`fo-${i}`));
      expect(result.name.endsWith('Lang')).toBe(false);
    }
  });

  it('falls back to deterministic enumeration after the rejection cap', () => {
    // A single-combination group: one given, one family. Every random draw
    // produces the same name, so once it is used the random phase (bounded by
    // MAX_NAME_REJECTIONS) exhausts and the enumeration fallback runs — and
    // with the one combination used, it returns the enumerated name totally.
    const g: CultureGroup = {
      id: 'lib/tiny',
      name: 'Tiny',
      languages: ['x'],
      naming: { display: '{given} {family}', formal: '{family}' },
      given: { f: ['Aa'], m: ['Bb'] },
      family: ['Cc'],
      voiceTraits: [],
      mannerisms: [],
      backgrounds: [],
    };
    const used = new Set<string>([normaliseName('Bb Cc')]);
    // Must still return (totality) even though the only name is used.
    const result = nameNpc([g], weightsFor([g]), 'm', used, EMPTY_BLOCKLIST, createPrng('tiny'));
    expect(result.name).toBe('Bb Cc');
    expect(MAX_NAME_REJECTIONS).toBeGreaterThan(0);
  });
});

// --- determinism -----------------------------------------------------------

describe('nameNpc determinism', () => {
  it('is a pure function of its inputs and the PRNG state', () => {
    const g = germanGroup();
    const a = nameNpc([g], weightsFor([g]), 'f', new Set(), EMPTY_BLOCKLIST, createPrng('det'));
    const b = nameNpc([g], weightsFor([g]), 'f', new Set(), EMPTY_BLOCKLIST, createPrng('det'));
    expect(a).toEqual(b);
  });

  it('does not mutate the used-name set', () => {
    const g = germanGroup();
    const used = new Set<string>(['anna müller']);
    const before = new Set(used);
    nameNpc([g], weightsFor([g]), 'f', used, EMPTY_BLOCKLIST, createPrng('nomut'));
    expect(used).toEqual(before);
  });
});

// --- property: naming soundness --------------------------------------------

describe('Property 9 (partial): naming soundness', () => {
  // Pools large enough that each group's combination space dwarfs the max world
  // size (40), as the Req 11 quantity targets guarantee for shipped content
  // (≥100 given, ≥100 family). With pools this size the design's distinctness
  // claim holds without hitting the enumeration-exhaustion edge a tiny fixture
  // would.
  const bigGiven = (prefix: string): string[] =>
    Array.from({ length: 30 }, (_, i) => `${prefix}${i}`);
  const bigFamily = (prefix: string): string[] =>
    Array.from({ length: 30 }, (_, i) => `${prefix}fam${i}`);

  const groups: CultureGroup[] = [
    {
      id: 'lib/g-plain',
      name: 'Plain',
      languages: ['a'],
      naming: { display: '{given} {family}', formal: '{honorific} {family}' },
      given: { f: bigGiven('Fa'), m: bigGiven('Ma') },
      family: bigFamily('Pl'),
      voiceTraits: [],
      mannerisms: [],
      backgrounds: [],
    },
    {
      id: 'lib/g-patronymic',
      name: 'Patro',
      languages: ['b'],
      naming: {
        display: '{given} {patronymic} {family}',
        formal: '{given} {patronymic}',
        parts: { patronymic: { m: 'ovich', f: 'ovna' } },
      },
      given: { f: bigGiven('Fb'), m: bigGiven('Mb') },
      family: bigFamily('Pt').map((s) => ({ m: s, f: `${s}a` })),
      voiceTraits: [],
      mannerisms: [],
      backgrounds: [],
    },
    {
      id: 'lib/g-second',
      name: 'Second',
      languages: ['c'],
      naming: {
        display: '{given} {family} {family2}',
        formal: '{honorific} {family}',
        parts: { family2: true },
      },
      given: { f: bigGiven('Fc'), m: bigGiven('Mc') },
      family: bigFamily('Se'),
      voiceTraits: [],
      mannerisms: [],
      backgrounds: [],
    },
  ];
  const weights = weightsFor(groups);

  it('names a whole world with distinct, non-blocklisted names, deterministically', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 12 }),
        fc.integer({ min: 1, max: 40 }),
        (seed, count) => {
          // A small blocklist drawn from the pools to exercise rejection: a
          // plain-group full name and a surname blocked family-only.
          const blocklist = normaliseBlocklist([
            { name: 'Ma0 Plfam0' },
            { name: 'Plfam3', familyOnly: true },
          ]);

          const nameWorld = (): string[] => {
            const rng = createPrng(seed);
            const used = new Set<string>();
            const names: string[] = [];
            for (let i = 0; i < count; i += 1) {
              // The caller draws gender first (design order), then names.
              const gender: NameGender = rng.bool() ? 'f' : 'm';
              const result = nameNpc(groups, weights, gender, used, blocklist, rng);
              const normal = normaliseName(result.name);
              names.push(normal);
              used.add(normal);
            }
            return names;
          };

          const names = nameWorld();

          // Distinct full names (Req 7.2) — the combination space dwarfs 40.
          expect(new Set(names).size).toBe(names.length);
          // None blocklisted (Req 7.2/7.3).
          for (const n of names) {
            expect(blocklist.fullNames.has(n)).toBe(false);
            const surname = n.split(' ').pop() as string;
            expect(blocklist.familyNames.has(surname)).toBe(false);
          }
          // Deterministic from the seed (Req 7.4).
          expect(nameWorld()).toEqual(names);
        },
      ),
      { numRuns: 60 },
    );
  });
});
