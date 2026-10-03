/**
 * The Tag Vocabulary kind and the `tags` field on slice kinds (content-expansion
 * task 1.3; Req 4.1, 4.2, 4.3).
 *
 * These tests pin the schema shape task 1.3 adds: the facet, Tag and Required
 * Query schemas, the `<facet>:<value>` Tag id grammar, the 1–3 Tag Query bound
 * and the `minInstantiated <= minStatic` rule, plus the required `tags` field
 * on archetypes, Location Types and Cover Identities. The loader checks that
 * enforce the vocabulary and the "at least one Tag" rule (Req 4.3–4.5) arrive
 * in task 2 and are tested there.
 */

import { describe, expect, it } from 'vitest';

import {
  ArchetypeSchema,
  CoverIdentitySchema,
  LocationTypeSchema,
} from '../lib/kinds.js';
import {
  FacetSchema,
  RequiredQuerySchema,
  TagSchema,
  TagVocabularySchema,
  tagVocabularyKind,
} from './tag-vocabulary.js';

// --- facets, Tags and Required Queries -------------------------------------

describe('Tag Vocabulary schema (Req 4.1, 4.2)', () => {
  const facet = { id: 'function', appliesTo: ['location', 'location-type'] };
  const tag = {
    id: 'function:dead-drop-site',
    description: 'Concealment possible; low passing attention',
  };
  const requiredQuery = {
    id: 'rq-drop',
    query: ['function:dead-drop-site'],
    minStatic: 5,
    minInstantiated: 2,
  };

  it('accepts a facet with a non-empty appliesTo', () => {
    expect(() => FacetSchema.parse(facet)).not.toThrow();
  });

  it('rejects a facet that applies to nothing', () => {
    expect(() => FacetSchema.parse({ id: 'function', appliesTo: [] })).toThrow();
  });

  it('accepts a Tag of the form <facet>:<value> with a description', () => {
    expect(() => TagSchema.parse(tag)).not.toThrow();
  });

  it('rejects a Tag id without a facet prefix', () => {
    expect(() =>
      TagSchema.parse({ id: 'dead-drop-site', description: 'x' }),
    ).toThrow();
  });

  it('rejects a Tag with no description', () => {
    expect(() =>
      TagSchema.parse({ id: 'function:dead-drop-site', description: '' }),
    ).toThrow();
  });

  it('accepts an optional per-Tag appliesTo', () => {
    expect(() =>
      TagSchema.parse({ ...tag, appliesTo: ['location'] }),
    ).not.toThrow();
  });

  it('accepts a Required Query with 1–3 Tags and bounds', () => {
    expect(() => RequiredQuerySchema.parse(requiredQuery)).not.toThrow();
    expect(() =>
      RequiredQuerySchema.parse({
        ...requiredQuery,
        query: ['function:meeting-spot', 'access:public'],
      }),
    ).not.toThrow();
  });

  it('rejects a Required Query with no Tags or more than three', () => {
    expect(() =>
      RequiredQuerySchema.parse({ ...requiredQuery, query: [] }),
    ).toThrow();
    expect(() =>
      RequiredQuerySchema.parse({
        ...requiredQuery,
        query: ['a:1', 'b:2', 'c:3', 'd:4'],
      }),
    ).toThrow();
  });

  it('rejects minInstantiated greater than minStatic', () => {
    expect(() =>
      RequiredQuerySchema.parse({
        ...requiredQuery,
        minStatic: 1,
        minInstantiated: 2,
      }),
    ).toThrow();
  });

  it('accepts minInstantiated 0 for Content-Set-wide queries', () => {
    expect(() =>
      RequiredQuerySchema.parse({
        id: 'rq-civilian',
        query: ['role:civilian'],
        minStatic: 12,
        minInstantiated: 0,
      }),
    ).not.toThrow();
  });

  it('parses the whole vocabulary file and defaults requiredQueries to []', () => {
    const parsed = TagVocabularySchema.parse({ facets: [facet], tags: [tag] });
    expect(parsed.requiredQueries).toEqual([]);
    const full = TagVocabularySchema.parse({
      facets: [facet],
      tags: [tag],
      requiredQueries: [requiredQuery],
    });
    expect(full.requiredQueries).toHaveLength(1);
  });

  it('rejects a vocabulary with no facets or no Tags', () => {
    expect(() => TagVocabularySchema.parse({ facets: [], tags: [tag] })).toThrow();
    expect(() =>
      TagVocabularySchema.parse({ facets: [facet], tags: [] }),
    ).toThrow();
  });

  it('rejects an unknown top-level key', () => {
    expect(() =>
      TagVocabularySchema.parse({ facets: [facet], tags: [tag], extra: true }),
    ).toThrow();
  });
});

// --- the registration ------------------------------------------------------

describe('tag-vocabulary registration', () => {
  it('is a core/extension, non-City-Scoped kind at dir "tags"', () => {
    expect(tagVocabularyKind.kind).toBe('tag-vocabulary');
    expect(tagVocabularyKind.dir).toBe('tags');
    expect(tagVocabularyKind.cityScoped).toBe(false);
    expect([...tagVocabularyKind.roles].sort()).toEqual(['core', 'extension']);
  });

  it('declares the Required Queries as a Tag Query field (Req 4.8)', () => {
    expect(tagVocabularyKind.fields.tagQueries).toEqual([
      'requiredQueries[].query',
    ]);
  });
});

// --- the `tags` field on slice kinds (Req 4.3) -----------------------------

describe('slice kinds carry a tags field', () => {
  const archetype = {
    id: 'waiter',
    role: 'civilian',
    allowedAllegiances: ['neutral'],
    mice: {
      money: { min: 0, max: 1 },
      ideology: { min: 0, max: 1 },
      coercion: { min: 0, max: 1 },
      ego: { min: 0, max: 1 },
    },
    wariness: { min: 0, max: 1 },
    personaPools: ['viennese'],
    descriptorPools: ['fifties-civilian'],
  };
  const locationType = {
    id: 'kaffeehaus',
    public: true,
    allowedActions: ['talk'],
    baseRisk: 0.2,
    allowsDeadDrops: false,
    namePatterns: ['Café {pick:names}'],
    descriptionPool: ['A warm coffee house.'],
    atmosphereTags: ['smoky'],
  };
  const coverIdentity = {
    id: 'trade-attache',
    title: 'Trade Attaché',
    employerOrg: 'Allied Trade Mission',
    fitLocationTypes: ['embassy'],
    suspicionModifiers: { atFit: -0.1, elsewhere: 0.2 },
  };

  it('defaults tags to [] when a pack omits them', () => {
    expect(ArchetypeSchema.parse(archetype).tags).toEqual([]);
    expect(LocationTypeSchema.parse(locationType).tags).toEqual([]);
    expect(CoverIdentitySchema.parse(coverIdentity).tags).toEqual([]);
  });

  it('accepts a list of vocabulary Tags', () => {
    expect(
      ArchetypeSchema.parse({ ...archetype, tags: ['role:civilian', 'trade:waiter'] })
        .tags,
    ).toEqual(['role:civilian', 'trade:waiter']);
    expect(
      LocationTypeSchema.parse({ ...locationType, tags: ['venue:cafe'] }).tags,
    ).toEqual(['venue:cafe']);
    expect(
      CoverIdentitySchema.parse({ ...coverIdentity, tags: ['cover:diplomatic'] })
        .tags,
    ).toEqual(['cover:diplomatic']);
  });

  it('rejects a tag that is not of the form <facet>:<value>', () => {
    expect(() =>
      ArchetypeSchema.parse({ ...archetype, tags: ['civilian'] }),
    ).toThrow();
    expect(() =>
      LocationTypeSchema.parse({ ...locationType, tags: ['Venue:Cafe'] }),
    ).toThrow();
  });
});
