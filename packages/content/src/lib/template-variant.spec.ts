/**
 * Tests for Template Variant compilation and resolution (content-expansion
 * task 2.2).
 *
 * Cover the slot-set check (acceptance on an exact match, refusal listing the
 * missing and extra slots), the city → era → base resolution order, the
 * fall-back to a base when a variant was refused, the `'core'` city path and
 * the per-`(base, city)` memo.
 */

import { describe, expect, it } from 'vitest';

import { parseTemplate, templateSlots } from './template.js';
import type { DocumentTemplate } from './kinds.js';
import {
  compileTemplateVariants,
  documentBaseTemplate,
  emptyTemplateVariantIndex,
  resolveTemplate,
  type BaseTemplate,
  type RawVariant,
} from './template-variant.js';

// --- helpers ---------------------------------------------------------------

/** A base template built directly from a source string. */
function base(id: string, source: string): BaseTemplate {
  const ast = parseTemplate(source);
  return { id, ast, slots: templateSlots(ast) };
}

/** A city-scoped raw variant. */
function cityVariant(
  variantId: string,
  baseId: string,
  city: string,
  template: string,
): RawVariant {
  return { variantId, base: baseId, scope: { kind: 'city', id: city }, template };
}

/** An era-scoped raw variant. */
function eraVariant(
  variantId: string,
  baseId: string,
  era: string,
  template: string,
): RawVariant {
  return { variantId, base: baseId, scope: { kind: 'era', id: era }, template };
}

/** A Content-Set stand-in carrying only the variant index the resolver reads. */
function withIndex(index: ReturnType<typeof compileTemplateVariants>['index']) {
  return { templateVariants: index };
}

// --- documentBaseTemplate --------------------------------------------------

describe('documentBaseTemplate', () => {
  it('unions the slots of the title pattern and every section body', () => {
    const doc: DocumentTemplate = {
      id: 'd',
      kind: 'newspaper',
      titlePattern: '{headline}',
      sections: [
        { id: 'lede', body: 'In {place}, {subject} was seen {when}.' },
        { id: 'body', body: 'Witnesses named {object}.' },
      ],
      slots: [],
    };
    const compiled = documentBaseTemplate('core/d', doc);
    expect(compiled.id).toBe('core/d');
    expect([...compiled.slots].sort()).toEqual([
      'headline',
      'object',
      'place',
      'subject',
      'when',
    ]);
  });
});

// --- compileTemplateVariants: slot-set check -------------------------------

describe('compileTemplateVariants — slot-set check (Req 8.3)', () => {
  const bases = new Map([['core/article', base('core/article', 'A meeting at {place} {when}.')]]);

  it('accepts a variant whose slot set equals its base', () => {
    const { index, errors } = compileTemplateVariants(
      [cityVariant('v', 'core/article', 'city-vienna', 'Treffen im {place} {when}.')],
      bases,
    );
    expect(errors).toEqual([]);
    expect(index.cityVariants.size).toBe(1);
  });

  it('reorders and optional sections do not change the slot set', () => {
    const { errors } = compileTemplateVariants(
      [cityVariant('v', 'core/article', 'c', '{when} at {place}{?place}.{/place}')],
      bases,
    );
    expect(errors).toEqual([]);
  });

  it('refuses a variant missing a base slot and lists it', () => {
    const { index, errors } = compileTemplateVariants(
      [cityVariant('v', 'core/article', 'c', 'A meeting at {place}.')],
      bases,
    );
    expect(index.cityVariants.size).toBe(0);
    expect(errors).toHaveLength(1);
    expect(errors[0].path).toBe('template');
    expect(errors[0].message).toContain('missing [when]');
    expect(errors[0].message).toContain('extra []');
  });

  it('refuses a variant with an extra slot and lists it', () => {
    const { errors } = compileTemplateVariants(
      [cityVariant('v', 'core/article', 'c', 'A meeting at {place} {when} with {who}.')],
      bases,
    );
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain('missing []');
    expect(errors[0].message).toContain('extra [who]');
  });

  it('lists both missing and extra slots when both differ', () => {
    const { errors } = compileTemplateVariants(
      [cityVariant('v', 'core/article', 'c', 'A meeting at {place} with {who}.')],
      bases,
    );
    expect(errors[0].message).toContain('missing [when]');
    expect(errors[0].message).toContain('extra [who]');
  });

  it('reports an unknown base', () => {
    const { errors } = compileTemplateVariants(
      [cityVariant('v', 'core/missing', 'c', 'anything {place} {when}')],
      bases,
    );
    expect(errors[0].path).toBe('base');
    expect(errors[0].message).toContain('core/missing');
  });

  it('reports an unparsable variant template', () => {
    const { errors } = compileTemplateVariants(
      [cityVariant('v', 'core/article', 'c', 'bad {place} {when} {')],
      bases,
    );
    expect(errors[0].path).toBe('template');
  });
});

// --- resolveTemplate: order ------------------------------------------------

describe('resolveTemplate — city, then era, then base (Req 8.2)', () => {
  const bases = new Map([['core/article', base('core/article', '{place}')]]);

  function index(variants: RawVariant[]) {
    const result = compileTemplateVariants(variants, bases);
    expect(result.errors).toEqual([]);
    return result.index;
  }

  it('returns the city variant when one exists for the city', () => {
    const set = withIndex(
      index([
        cityVariant('city-v', 'core/article', 'city-vienna', 'Stadt {place}'),
        eraVariant('era-v', 'core/article', 'era-cw', 'Ära {place}'),
      ]),
    );
    const resolved = resolveTemplate(set, 'core/article', 'city-vienna');
    expect(resolved?.ast.source).toBe('Stadt {place}');
  });

  it('falls back to the era variant when the city has none', () => {
    const set = withIndex(
      index([
        cityVariant('city-v', 'core/article', 'city-berlin', 'Berlin {place}'),
        eraVariant('era-v', 'core/article', 'era-cw', 'Ära {place}'),
      ]),
    );
    const resolved = resolveTemplate(set, 'core/article', 'city-vienna');
    expect(resolved?.ast.source).toBe('Ära {place}');
  });

  it('falls back to the base when neither a city nor an era variant exists', () => {
    const set = withIndex(index([]));
    const resolved = resolveTemplate(set, 'core/article', 'city-vienna');
    expect(resolved?.ast.source).toBe('{place}');
  });

  it('never uses a city variant for the core city', () => {
    const set = withIndex(
      index([
        cityVariant('city-v', 'core/article', 'city-vienna', 'Stadt {place}'),
        eraVariant('era-v', 'core/article', 'era-cw', 'Ära {place}'),
      ]),
    );
    const resolved = resolveTemplate(set, 'core/article', 'core');
    expect(resolved?.ast.source).toBe('Ära {place}');
  });

  it('returns the base for the core city when no era variant exists', () => {
    const set = withIndex(
      index([cityVariant('city-v', 'core/article', 'city-vienna', 'Stadt {place}')]),
    );
    const resolved = resolveTemplate(set, 'core/article', 'core');
    expect(resolved?.ast.source).toBe('{place}');
  });

  it('returns undefined for an unknown base', () => {
    const set = withIndex(index([]));
    expect(resolveTemplate(set, 'core/nope', 'city-vienna')).toBeUndefined();
  });

  it('returns the same cached value on repeated calls', () => {
    const set = withIndex(
      index([cityVariant('city-v', 'core/article', 'city-vienna', 'Stadt {place}')]),
    );
    const first = resolveTemplate(set, 'core/article', 'city-vienna');
    const second = resolveTemplate(set, 'core/article', 'city-vienna');
    expect(second).toBe(first);
  });
});

// --- empty index -----------------------------------------------------------

describe('emptyTemplateVariantIndex', () => {
  it('resolves nothing', () => {
    const set = withIndex(emptyTemplateVariantIndex());
    expect(resolveTemplate(set, 'core/article', 'city-vienna')).toBeUndefined();
  });
});
