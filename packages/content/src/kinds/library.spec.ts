/**
 * The Library kinds (content-expansion task 1.6).
 *
 * These tests pin the `CultureGroup` and `DescriptorFragment` schemas and their
 * Field Declarations: the Naming Rule (display/formal patterns and the optional
 * Iberian second surname and gendered Russian patronymic), the gendered family
 * names, the gender-split given names, the Year-ranged persona backgrounds, and
 * the Descriptor Fragment's slot, optional gender/year/climate filters. It also
 * checks both kinds are Library-only and not City-Scoped, and that the loader
 * and linter can walk their declared text, Tag and Year Range fields.
 * Requirements 6.1, 6.2, 6.3, 17.1.
 */

import { describe, expect, it } from 'vitest';

import {
  CultureGroupSchema,
  DESCRIPTOR_SLOTS,
  DescriptorFragmentSchema,
  cultureGroupKind,
  descriptorFragmentKind,
} from '../index.js';

// --- fixtures --------------------------------------------------------------

const czech = {
  id: 'czech',
  name: 'Czech',
  languages: ['Czech', 'German'],
  naming: {
    display: '{given} {family}',
    formal: '{honorific} {family}',
  },
  given: { f: ['Marie', 'Jana'], m: ['Jan', 'Pavel'] },
  // A plain surname and a gendered pair (Novák / Nováková).
  family: ['Svoboda', { m: 'Novák', f: 'Nováková' }],
  voiceTraits: ['clipped vowels'],
  mannerisms: ['taps the table twice'],
  backgrounds: [
    { text: 'a tram depot machinist', tags: ['trade:worker'], years: { from: 1945, to: 1960 } },
    { text: 'a ministry filing clerk', tags: [] },
  ],
};

const russian = {
  id: 'russian',
  name: 'Russian',
  languages: ['Russian'],
  naming: {
    display: '{given} {patronymic} {family}',
    formal: '{honorific} {family}',
    parts: { patronymic: { m: 'ovich', f: 'ovna' } },
  },
  given: { f: ['Olga'], m: ['Ivan'] },
  family: [{ m: 'Petrov', f: 'Petrova' }],
};

const descriptor = {
  id: 'fur-ushanka',
  slot: 'headwear',
  text: 'a fur ushanka pulled low',
  gender: 'm',
  years: { from: 1945, to: 1965 },
  climate: ['climate:cold'],
};

// --- CultureGroup ----------------------------------------------------------

describe('CultureGroupSchema (Req 6.1, 7.1)', () => {
  it('accepts a full culture group with gendered family names', () => {
    const parsed = CultureGroupSchema.parse(czech);
    expect(parsed.id).toBe('czech');
    expect(parsed.family).toContainEqual({ m: 'Novák', f: 'Nováková' });
    expect(parsed.family).toContain('Svoboda');
    expect(parsed.backgrounds).toHaveLength(2);
  });

  it('accepts a naming rule with a gendered patronymic', () => {
    const parsed = CultureGroupSchema.parse(russian);
    expect(parsed.naming.parts?.patronymic).toEqual({ m: 'ovich', f: 'ovna' });
  });

  it('accepts the Iberian second-surname flag', () => {
    const parsed = CultureGroupSchema.parse({
      ...russian,
      naming: { display: '{given} {family} {family2}', formal: '{honorific} {family}', parts: { family2: true } },
    });
    expect(parsed.naming.parts?.family2).toBe(true);
  });

  it('defaults voiceTraits, mannerisms and backgrounds to empty lists', () => {
    const parsed = CultureGroupSchema.parse(russian);
    expect(parsed.voiceTraits).toEqual([]);
    expect(parsed.mannerisms).toEqual([]);
    expect(parsed.backgrounds).toEqual([]);
  });

  it('defaults a background tags list to empty', () => {
    const parsed = CultureGroupSchema.parse(czech);
    expect(parsed.backgrounds[1].tags).toEqual([]);
  });

  it('requires at least one language, given name per gender and family name', () => {
    expect(CultureGroupSchema.safeParse({ ...czech, languages: [] }).success).toBe(false);
    expect(CultureGroupSchema.safeParse({ ...czech, given: { f: [], m: ['Jan'] } }).success).toBe(false);
    expect(CultureGroupSchema.safeParse({ ...czech, given: { f: ['Marie'], m: [] } }).success).toBe(false);
    expect(CultureGroupSchema.safeParse({ ...czech, family: [] }).success).toBe(false);
  });

  it('rejects a gendered family name missing a form', () => {
    expect(
      CultureGroupSchema.safeParse({ ...czech, family: [{ m: 'Novák' }] }).success,
    ).toBe(false);
  });

  it('rejects an inverted background year range', () => {
    expect(
      CultureGroupSchema.safeParse({
        ...czech,
        backgrounds: [{ text: 'x', tags: [], years: { from: 1960, to: 1945 } }],
      }).success,
    ).toBe(false);
  });

  it('rejects an unknown top-level field (strict object)', () => {
    expect(CultureGroupSchema.safeParse({ ...czech, region: 'Bohemia' }).success).toBe(false);
  });
});

// --- DescriptorFragment ----------------------------------------------------

describe('DescriptorFragmentSchema (Req 6.3)', () => {
  it('accepts a full descriptor fragment', () => {
    const parsed = DescriptorFragmentSchema.parse(descriptor);
    expect(parsed.slot).toBe('headwear');
    expect(parsed.gender).toBe('m');
    expect(parsed.climate).toEqual(['climate:cold']);
  });

  it('accepts a minimal fragment with only slot and text', () => {
    const parsed = DescriptorFragmentSchema.parse({
      id: 'tall',
      slot: 'build',
      text: 'tall and spare',
    });
    expect(parsed.gender).toBeUndefined();
    expect(parsed.years).toBeUndefined();
    expect(parsed.climate).toBeUndefined();
  });

  it('exposes exactly the six descriptor slots', () => {
    expect([...DESCRIPTOR_SLOTS]).toEqual([
      'build',
      'age',
      'clothing',
      'headwear',
      'feature',
      'carried',
    ]);
    for (const slot of DESCRIPTOR_SLOTS) {
      expect(
        DescriptorFragmentSchema.safeParse({ id: 'x', slot, text: 't' }).success,
      ).toBe(true);
    }
  });

  it('rejects an unknown slot', () => {
    expect(
      DescriptorFragmentSchema.safeParse({ id: 'x', slot: 'gait', text: 't' }).success,
    ).toBe(false);
  });

  it('rejects an unknown gender', () => {
    expect(
      DescriptorFragmentSchema.safeParse({ ...descriptor, gender: 'x' }).success,
    ).toBe(false);
  });

  it('rejects an unknown top-level field (strict object)', () => {
    expect(
      DescriptorFragmentSchema.safeParse({ ...descriptor, height: 180 }).success,
    ).toBe(false);
  });
});

// --- registrations ---------------------------------------------------------

describe('library kind registrations (Req 17.1)', () => {
  it('registers culture-group as a Library kind that is not City-Scoped', () => {
    expect(cultureGroupKind.kind).toBe('culture-group');
    expect(cultureGroupKind.dir).toBe('culture-groups');
    expect(cultureGroupKind.roles).toEqual(['library']);
    expect(cultureGroupKind.cityScoped).toBe(false);
    expect(cultureGroupKind.owner).toContain('content');
  });

  it('declares the culture-group text, tag and year fields', () => {
    expect(cultureGroupKind.fields.text).toEqual([
      'items[].voiceTraits[]',
      'items[].mannerisms[]',
      'items[].backgrounds[].text',
    ]);
    expect(cultureGroupKind.fields.tags).toEqual(['items[].backgrounds[].tags[]']);
    expect(cultureGroupKind.fields.years).toEqual(['items[].backgrounds[].years']);
  });

  it('registers descriptor-fragment as a Library kind that is not City-Scoped', () => {
    expect(descriptorFragmentKind.kind).toBe('descriptor-fragment');
    expect(descriptorFragmentKind.dir).toBe('descriptor-fragments');
    expect(descriptorFragmentKind.roles).toEqual(['library']);
    expect(descriptorFragmentKind.cityScoped).toBe(false);
  });

  it('declares the descriptor-fragment text, tag and year fields', () => {
    expect(descriptorFragmentKind.fields.text).toEqual(['items[].text']);
    expect(descriptorFragmentKind.fields.tags).toEqual(['items[].climate[]']);
    expect(descriptorFragmentKind.fields.years).toEqual(['items[].years']);
  });
});
