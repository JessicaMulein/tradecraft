/**
 * Tests for the Locale and Template Variant schemas and their registrations
 * (content-expansion task 1.7).
 *
 * Cover a valid Locale and Template Variant, the closed scope union, the month
 * and weekday length checks, and the registry contract (roles, City-Scoped,
 * Field Declarations) tasks 1.2 and 2.1 rely on.
 */

import { describe, expect, it } from 'vitest';

import {
  LocaleSchema,
  TemplateVariantSchema,
  localeKind,
  templateVariantKind,
} from './locale.js';

const validLocale = {
  scope: { city: 'city-vienna' },
  date: {
    long: '{weekday}, {day} {month} {year}',
    short: '{day}.{month}.{year}',
    months: [
      'January',
      'February',
      'March',
      'April',
      'May',
      'June',
      'July',
      'August',
      'September',
      'October',
      'November',
      'December',
    ],
    weekdays: [
      'Monday',
      'Tuesday',
      'Wednesday',
      'Thursday',
      'Friday',
      'Saturday',
      'Sunday',
    ],
  },
  currency: { pattern: '{amount} {symbol}' },
  honorifics: { f: ['Frau'], m: ['Herr'] },
  address: '{street} {number}, {district}',
  terms: [{ term: 'Beisl', definition: 'a small pub' }],
  allowNames: ['Prater'],
};

describe('LocaleSchema', () => {
  it('accepts a well-formed city Locale', () => {
    expect(LocaleSchema.safeParse(validLocale).success).toBe(true);
  });

  it('accepts an era-scoped Locale', () => {
    const era = { ...validLocale, scope: { era: 'era-cold-war-early' } };
    expect(LocaleSchema.safeParse(era).success).toBe(true);
  });

  it('defaults optional terms and allowNames to empty lists', () => {
    const { terms, allowNames, ...rest } = validLocale;
    void terms;
    void allowNames;
    const parsed = LocaleSchema.parse(rest);
    expect(parsed.terms).toEqual([]);
    expect(parsed.allowNames).toEqual([]);
  });

  it('rejects a scope naming both a city and an era', () => {
    const both = {
      ...validLocale,
      scope: { city: 'city-vienna', era: 'era-cold-war-early' },
    };
    expect(LocaleSchema.safeParse(both).success).toBe(false);
  });

  it('rejects a month list that is not twelve long', () => {
    const short = {
      ...validLocale,
      date: { ...validLocale.date, months: ['January'] },
    };
    expect(LocaleSchema.safeParse(short).success).toBe(false);
  });

  it('rejects a weekday list that is not seven long', () => {
    const short = {
      ...validLocale,
      date: { ...validLocale.date, weekdays: ['Monday'] },
    };
    expect(LocaleSchema.safeParse(short).success).toBe(false);
  });

  it('rejects an empty honorific list', () => {
    const empty = {
      ...validLocale,
      honorifics: { f: [], m: ['Herr'] },
    };
    expect(LocaleSchema.safeParse(empty).success).toBe(false);
  });

  it('rejects an unknown top-level field', () => {
    const extra = { ...validLocale, timezone: 'CET' };
    expect(LocaleSchema.safeParse(extra).success).toBe(false);
  });
});

describe('TemplateVariantSchema', () => {
  const variant = {
    id: 'vienna-cafe-article',
    base: 'cafe-article',
    scope: { city: 'city-vienna' },
    template: 'Im {place} traf sich...',
  };

  it('accepts a well-formed variant', () => {
    expect(TemplateVariantSchema.safeParse(variant).success).toBe(true);
  });

  it('accepts an era-scoped variant', () => {
    const era = { ...variant, scope: { era: 'era-cold-war-early' } };
    expect(TemplateVariantSchema.safeParse(era).success).toBe(true);
  });

  it('rejects a variant missing its base template', () => {
    const { base, ...rest } = variant;
    void base;
    expect(TemplateVariantSchema.safeParse(rest).success).toBe(false);
  });

  it('rejects an empty replacement template', () => {
    expect(
      TemplateVariantSchema.safeParse({ ...variant, template: '' }).success,
    ).toBe(false);
  });
});

describe('registrations', () => {
  it('registers locale for era and city packs as City-Scoped', () => {
    expect(localeKind.kind).toBe('locale');
    expect(localeKind.dir).toBe('locale');
    expect([...localeKind.roles].sort()).toEqual(['city', 'era']);
    expect(localeKind.cityScoped).toBe(true);
    expect(localeKind.schema).toBe(LocaleSchema);
  });

  it('declares the Locale text and name fields for the linter', () => {
    expect(localeKind.fields.text).toContain('items[].terms[].term');
    expect(localeKind.fields.names).toContain('items[].allowNames[]');
  });

  it('registers template-variant for era and city packs as City-Scoped', () => {
    expect(templateVariantKind.kind).toBe('template-variant');
    expect(templateVariantKind.dir).toBe('template-variants');
    expect([...templateVariantKind.roles].sort()).toEqual(['city', 'era']);
    expect(templateVariantKind.cityScoped).toBe(true);
    expect(templateVariantKind.schema).toBe(TemplateVariantSchema);
  });

  it('declares the variant template as a localisable field', () => {
    expect(templateVariantKind.fields.templates).toEqual([
      { path: 'items[].template', style: 'other' },
    ]);
  });
});
