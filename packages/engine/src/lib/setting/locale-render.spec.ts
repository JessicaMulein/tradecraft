/**
 * Tests for the Locale and Template Variant rendering wiring (content-expansion
 * task 3.6): `buildLocaleContext`, the city-voice formatters (`formatWhen`,
 * `formatAmount`, `formatAddressParts`, `honorific`), the Locale-aware namer,
 * the variant resolver, the Local-Terms glossary merge, the Specifics-Guard
 * allowed-name set and the currency scaling.
 *
 * These exercise the pure wiring with hand-built minimal {@link ContentSetV2}
 * fixtures and a real compiled {@link TemplateVariantIndex}, so the checks pin
 * the behaviour the generator (task 3.8) depends on:
 *
 * - the Locale chain falls back city → era (Req 8.4), so a field the city
 *   Locale omits is taken from the era Locale and a field it defines wins;
 * - a date, money amount, address and honorific render in the chosen city's
 *   voice (Req 8.4), and the Core City uses the era Locale and a neutral
 *   currency;
 * - the variant resolver returns the city variant over the era variant over the
 *   base (Req 8.2);
 * - the city's Local Terms join the glossary (Req 8.5) and its `allowNames`
 *   plus Local Terms join the Specifics-Guard allowed-name set (Req 8.6);
 * - every money field scales by `budgetScale` and rounds to `rounding` at
 *   preset resolution (Req 9.6), and the Core City scaling is the identity.
 */

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import type {
  CityDefinition,
  DifficultyPreset,
  GlossaryTerm,
  Locale,
} from '@tradecraft/content';
import {
  compileTemplateVariants,
  documentBaseTemplate,
  formatDate as contentFormatDate,
  parseTemplate,
  templateSlots,
  type BaseTemplate,
} from '@tradecraft/content';

import type { GameTime } from '../model/core.js';
import type { CityBundle, ContentSetV2, EraBundle } from './content-set-v2.js';
import {
  CORE_CITY_CURRENCY,
  buildLocaleContext,
  formatAddressParts,
  formatAmount,
  formatWhen,
  honorific,
  localeNamer,
  resolveVariant,
} from './locale-render.js';
import {
  glossaryWithLocalTerms,
  specificsAllowedNames,
} from './locale-terms.js';
import {
  scaleMoney,
  scaleMoneyPolicy,
  scalePreset,
  type MoneyPolicy,
} from './currency.js';

// --- fixtures --------------------------------------------------------------

/** The era Locale: a complete long/short pattern plus month/weekday names. */
const ERA_LOCALE: Locale = {
  scope: { era: 'era/cold-war-early' },
  date: {
    long: '{weekday}, {day} {month} {year}',
    short: '{day}/{month}/{year}',
    months: [
      'Jan',
      'Feb',
      'Mar',
      'Apr',
      'May',
      'Jun',
      'Jul',
      'Aug',
      'Sep',
      'Oct',
      'Nov',
      'Dec',
    ],
    weekdays: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
  },
  currency: { pattern: '{amount} {symbol} (era)' },
  honorifics: { f: ['Era-Frau'], m: ['Era-Herr'] },
  address: '{street} {number} // {district} (era)',
  terms: [{ term: 'era-term', definition: 'defined by the era' }],
  allowNames: ['EraPlace'],
};

const ERA: EraBundle = {
  id: 'era/cold-war-early',
  period: { from: 1945, to: 1965 },
  locale: ERA_LOCALE,
};

/**
 * A city Locale that defines its own currency pattern, honorifics, address and
 * Local Terms, but *omits* a `date` block so the date falls back to the era.
 * Zod would require `date`; this fixture is cast because the wiring reads the
 * field structurally and the fallback behaviour is exactly what is under test.
 */
const CITY_LOCALE_NO_DATE = {
  scope: { city: 'city/one' },
  // date intentionally omitted to exercise the city → era fallback.
  currency: { pattern: '{symbol}{amount}' },
  honorifics: { f: ['Frau'], m: ['Herr'] },
  address: '{street} {number}, {district}',
  terms: [
    { term: 'Prater', definition: 'a large city park' },
    { term: 'era-term', definition: 'the city overrides the era term' },
  ],
  allowNames: ['Ringstrasse', 'Prater'],
} as unknown as Locale;

function cityDefinition(
  id: string,
  overrides: Partial<CityDefinition> = {},
): CityDefinition {
  return {
    id,
    name: 'Testville',
    country: 'Nowhere',
    climate: 'climate:temperate',
    period: { from: 1948, to: 1960 },
    startDates: { from: '1949-01-01', to: '1955-12-31' },
    currency: {
      name: 'Schilling',
      symbol: 'S',
      subunit: 'groschen',
      format: '{amount} {symbol}',
      rounding: 5,
      budgetScale: 10,
    },
    languages: [{ id: 'de', name: 'German', share: 1 }],
    cultureWeights: [{ group: 'g-main', weight: 1 }],
    services: ['svc-own'],
    ...overrides,
  };
}

function cityBundle(
  def: CityDefinition,
  locale: Locale,
): CityBundle {
  return {
    def,
    districts: [],
    locations: [],
    routes: [],
    locationTypes: [],
    newspapers: [],
    orgs: [],
    weather: { city: def.id, months: {} } as unknown as CityBundle['weather'],
    covers: [],
    streets: [],
    locale,
    variants: [],
    sources: [],
  };
}

function makeSet(parts: {
  cities?: Record<string, CityBundle>;
  era?: EraBundle;
  templateVariants?: ContentSetV2['templateVariants'];
}): ContentSetV2 {
  const base = {
    predicates: {},
    archetypes: new Map(),
    locationTypes: new Map(),
    plotTemplates: new Map(),
    sideThreadTemplates: new Map(),
    documentTemplates: new Map(),
    personaLibraries: new Map(),
    coverIdentities: new Map(),
    rumourTemplates: new Map(),
    hints: new Map(),
    glossary: new Map(),
    difficultyPresets: new Map(),
    services: new Map(),
    templateVariantDefs: new Map(),
    templateVariants: parts.templateVariants ?? {
      bases: new Map(),
      cityVariants: new Map(),
      eraVariants: new Map(),
    },
    manifest: {},
  } as unknown as ContentSetV2;
  return {
    ...base,
    cities: parts.cities ?? {},
    era: parts.era,
    cultureGroups: {},
    descriptorFragments: [],
    cityScopeOwner: {},
  };
}

const DEF = cityDefinition('city/one');
const CITY_SET = makeSet({
  era: ERA,
  cities: { 'city/one': cityBundle(DEF, CITY_LOCALE_NO_DATE) },
});

const CITY_CTX = buildLocaleContext(CITY_SET, 'city/one', '1950-01-01');
const CORE_CTX = buildLocaleContext(CITY_SET, 'core', '1950-01-01');

const T = (day: number): GameTime => ({ day, phase: 1 });

// --- buildLocaleContext + fallback chain -----------------------------------

describe('buildLocaleContext (Req 8.4)', () => {
  it('orders the Locale chain city then era for a City Pack', () => {
    expect(CITY_CTX.locales).toEqual([CITY_LOCALE_NO_DATE, ERA_LOCALE]);
    expect(CITY_CTX.currency).toEqual(DEF.currency);
    expect(CITY_CTX.city).toBe('city/one');
    expect(CITY_CTX.startDate).toBe('1950-01-01');
  });

  it('uses only the era Locale and the neutral currency for the Core City', () => {
    expect(CORE_CTX.locales).toEqual([ERA_LOCALE]);
    expect(CORE_CTX.currency).toEqual(CORE_CITY_CURRENCY);
    expect(CORE_CTX.city).toBe('core');
  });
});

// --- formatters -------------------------------------------------------------

describe('formatWhen (Req 8.4)', () => {
  it('renders the date through the first Locale with a date block (era fallback)', () => {
    // The city Locale omits `date`, so the era Locale supplies it. The result
    // matches the content formatter called with the same chain.
    const expected = contentFormatDate(
      { day: 10 },
      '1950-01-01',
      CITY_CTX.locales,
    );
    expect(formatWhen(CITY_CTX, T(10))).toBe(expected);
    // 1950-01-01 is a Sunday; +10 days = 1950-01-11, a Wednesday.
    expect(formatWhen(CITY_CTX, T(10))).toBe('Wed, 11 Jan 1950');
  });

  it('renders the short form when asked', () => {
    expect(formatWhen(CITY_CTX, T(0), 'short')).toBe('1/Jan/1950');
  });

  it('ignores the within-day phase (same date for every phase)', () => {
    const a = formatWhen(CITY_CTX, { day: 5, phase: 0 });
    const b = formatWhen(CITY_CTX, { day: 5, phase: 3 });
    expect(a).toBe(b);
  });
});

describe('formatAmount (Req 8.4)', () => {
  it('renders money through the city currency pattern (city wins over era)', () => {
    // City pattern "{symbol}{amount}" with symbol S; rounding 5 ⇒ 102 → 100.
    expect(formatAmount(CITY_CTX, 102)).toBe('S100');
  });

  it('falls back to the era currency pattern for the Core City', () => {
    // Core currency: symbol cr, rounding 1, era pattern "{amount} {symbol} (era)".
    expect(formatAmount(CORE_CTX, 42)).toBe('42 cr (era)');
  });
});

describe('formatAddressParts + honorific (Req 8.4)', () => {
  it('renders an address through the city Locale pattern', () => {
    expect(
      formatAddressParts(CITY_CTX, {
        street: 'Kärntner',
        number: '7',
        district: 'Innere Stadt',
      }),
    ).toBe('Kärntner 7, Innere Stadt');
  });

  it('renders the honorific from the city Locale', () => {
    expect(honorific(CITY_CTX, 'f')).toBe('Frau');
    expect(honorific(CITY_CTX, 'm')).toBe('Herr');
  });

  it('falls back to the era honorific for the Core City', () => {
    expect(honorific(CORE_CTX, 'f')).toBe('Era-Frau');
  });
});

// --- localeNamer ------------------------------------------------------------

describe('localeNamer (Req 8.4)', () => {
  it('formats a bound GameTime through the city Locale and delegates everything else', () => {
    const base = (v: unknown): string =>
      typeof v === 'string' ? `base:${v}` : `base:${String(v)}`;
    const namer = localeNamer(CITY_CTX, base);

    // A GameTime renders as the localised date, not the slice Day N form.
    expect(namer(T(10))).toBe('Wed, 11 Jan 1950');
    // Everything else goes to the wrapped namer untouched.
    expect(namer('npc:ana')).toBe('base:npc:ana');
    expect(namer(7)).toBe('base:7');
  });
});

// --- variant resolution -----------------------------------------------------

describe('resolveVariant (Req 8.2)', () => {
  /** Build a base template and a city + era variant over it, all same slots. */
  function variantIndex(): ContentSetV2['templateVariants'] {
    const baseSource = '{headline}\n{body}';
    const base: BaseTemplate = {
      id: 'core/article',
      ast: parseTemplate(baseSource),
      slots: templateSlots(parseTemplate(baseSource)),
    };
    const bases = new Map<string, BaseTemplate>([[base.id, base]]);
    const { index, errors } = compileTemplateVariants(
      [
        {
          variantId: 'city/one-article',
          base: 'core/article',
          scope: { kind: 'city', id: 'city/one' },
          template: 'CITY {headline}\n{body}',
        },
        {
          variantId: 'era/article',
          base: 'core/article',
          scope: { kind: 'era', id: 'era/cold-war-early' },
          template: 'ERA {headline}\n{body}',
        },
      ],
      bases,
    );
    expect(errors).toEqual([]);
    return index;
  }

  const set = makeSet({
    era: ERA,
    cities: { 'city/one': cityBundle(DEF, CITY_LOCALE_NO_DATE) },
    templateVariants: variantIndex(),
  });

  it('returns the city variant for a City Pack', () => {
    const resolved = resolveVariant(set, 'core/article', 'city/one');
    expect(resolved?.id).toBe('core/article');
    // The city variant's AST renders the "CITY " prefix.
    expect(JSON.stringify(resolved?.ast)).toContain('CITY ');
  });

  it('returns the era variant for the Core City (no city variant)', () => {
    const resolved = resolveVariant(set, 'core/article', 'core');
    expect(JSON.stringify(resolved?.ast)).toContain('ERA ');
  });

  it('returns undefined for an unknown base', () => {
    expect(resolveVariant(set, 'core/missing', 'city/one')).toBeUndefined();
  });

  it('is referenced via documentBaseTemplate for Document bases', () => {
    // Sanity: a Document template compiles to a base with its union slot set.
    const base = documentBaseTemplate('core/dossier', {
      titlePattern: 'DOSSIER {subject}',
      sections: [{ name: 's', body: '{assessment}' }],
    } as never);
    expect(base.slots.has('subject')).toBe(true);
    expect(base.slots.has('assessment')).toBe(true);
  });
});

// --- glossary + specifics ---------------------------------------------------

describe('glossaryWithLocalTerms (Req 8.5)', () => {
  const base = new Map<string, GlossaryTerm>([
    ['Asset', { term: 'Asset', definition: 'a recruited source' }],
    ['era-term', { term: 'era-term', definition: 'base definition' }],
  ]);

  it('adds the city Local Terms to the glossary, city overriding a shared term', () => {
    const merged = glossaryWithLocalTerms(base, CITY_CTX);
    expect(merged.get('Asset')?.definition).toBe('a recruited source');
    expect(merged.get('Prater')?.definition).toBe('a large city park');
    // The city's "era-term" wins over the base glossary entry of the same name.
    expect(merged.get('era-term')?.definition).toBe(
      'the city overrides the era term',
    );
  });

  it('does not mutate the base map', () => {
    const before = base.size;
    glossaryWithLocalTerms(base, CITY_CTX);
    expect(base.size).toBe(before);
    expect(base.has('Prater')).toBe(false);
  });

  it('returns a fresh copy of the base for the Core City (era leads, adds its term)', () => {
    const merged = glossaryWithLocalTerms(base, CORE_CTX);
    expect(merged).not.toBe(base);
    // The era Locale leads for the Core City, so its term is added.
    expect(merged.get('era-term')?.definition).toBe('defined by the era');
  });
});

describe('specificsAllowedNames (Req 8.6)', () => {
  it('combines allowNames and Local Terms, de-duplicated and ordered', () => {
    // allowNames: Ringstrasse, Prater; terms: Prater, era-term.
    // Prater appears in both; kept once, in allowNames order.
    expect(specificsAllowedNames(CITY_CTX)).toEqual([
      'Ringstrasse',
      'Prater',
      'era-term',
    ]);
  });

  it('uses the era Locale for the Core City', () => {
    // Era allowNames: EraPlace; era terms: era-term.
    expect(specificsAllowedNames(CORE_CTX)).toEqual(['EraPlace', 'era-term']);
  });
});

// --- currency scaling -------------------------------------------------------

describe('scaleMoney (Req 9.6)', () => {
  const currency = DEF.currency; // budgetScale 10, rounding 5.

  it('scales by budgetScale and rounds to the rounding step', () => {
    // 12 × 10 = 120 → nearest 5 = 120.
    expect(scaleMoney(12, currency)).toBe(120);
    // 13 × 10 = 130 → 130. 1 × 10 = 10 → 10. 0 → 0.
    expect(scaleMoney(1, currency)).toBe(10);
    expect(scaleMoney(0, currency)).toBe(0);
  });

  it('rounds a non-multiple to the nearest step, ties away from zero', () => {
    // scale 1, rounding 5: 12 → 10, 13 → 15, 2.5 → not integer input, use 23 → 25.
    const c = { ...currency, budgetScale: 1, rounding: 5 };
    expect(scaleMoney(12, c)).toBe(10);
    expect(scaleMoney(13, c)).toBe(15);
    expect(scaleMoney(23, c)).toBe(25);
  });

  it('is the identity for the Core City currency', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 1_000_000 }), (amount) => {
        expect(scaleMoney(amount, CORE_CITY_CURRENCY)).toBe(amount);
      }),
    );
  });

  it('result is always a multiple of the rounding step', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 100_000 }),
        fc.integer({ min: 1, max: 100 }),
        fc.double({ min: 0.001, max: 1000, noNaN: true }),
        (amount, rounding, budgetScale) => {
          const c = { ...DEF.currency, rounding, budgetScale };
          const scaled = scaleMoney(amount, c);
          expect(Number.isInteger(scaled / rounding)).toBe(true);
        },
      ),
    );
  });
});

describe('scalePreset + scaleMoneyPolicy (Req 9.6)', () => {
  const preset = {
    id: 'core/standard',
    startingBudget: 500,
    hintsDefault: true,
    allowedCiphers: ['caesar'],
  } as unknown as DifficultyPreset;

  it('scales only the startingBudget and preserves every other field', () => {
    const scaled = scalePreset(preset, DEF.currency);
    expect(scaled.startingBudget).toBe(scaleMoney(500, DEF.currency)); // 5000.
    expect(scaled.id).toBe('core/standard');
    expect(scaled.hintsDefault).toBe(true);
    expect(scaled.allowedCiphers).toEqual(['caesar']);
    // The input preset is not mutated.
    expect(preset.startingBudget).toBe(500);
  });

  it('is the identity for the Core City currency', () => {
    expect(scalePreset(preset, CORE_CITY_CURRENCY).startingBudget).toBe(500);
  });

  it('scales every scenario money field', () => {
    const policy: MoneyPolicy = {
      fundsBase: 100,
      fundsCap: 1000,
      retainer: 50,
      pitchAmount: 30,
    };
    const scaled = scaleMoneyPolicy(policy, DEF.currency); // ×10, round 5.
    expect(scaled).toEqual({
      fundsBase: 1000,
      fundsCap: 10000,
      retainer: 500,
      pitchAmount: 300,
    });
  });
});
