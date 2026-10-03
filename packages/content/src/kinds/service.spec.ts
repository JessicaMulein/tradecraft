/**
 * The Service Definition kind (content-expansion task 1.8).
 *
 * These tests pin the `ServiceDefinition` schema and its Field Declarations:
 * the required id/name/kind/country, the closed `ServiceKind` enum, the
 * `doctrineBase` slice of the slice Hostile Service doctrine (three dimensions
 * in `[0, 1]`, each optional), the optional Year Range and Tags, and that the
 * registration is allowed in Era and City Packs and is City-Scoped (so a City
 * Pack's local-security service is owned by its city). Requirements 3.5, 19.1,
 * 19.4.
 */

import { describe, expect, it } from 'vitest';

import {
  SERVICE_KINDS,
  ServiceDefinitionSchema,
  serviceKind,
} from '../index.js';

// --- fixtures --------------------------------------------------------------

const ownService = {
  id: 'own-service',
  name: 'The Firm',
  aliases: [{ text: 'the Service', distinctive: true }],
  kind: 'own',
  country: 'United Kingdom',
  doctrineBase: { riskTolerance: 0.4, securityConsciousness: 0.6 },
  years: { from: 1945, to: 1965 },
  tags: ['affiliation:station'],
};

// --- schema ----------------------------------------------------------------

describe('ServiceDefinitionSchema (Req 3.5, 19.1)', () => {
  it('accepts a full service definition', () => {
    const parsed = ServiceDefinitionSchema.parse(ownService);
    expect(parsed.kind).toBe('own');
    expect(parsed.name).toBe('The Firm');
    expect(parsed.doctrineBase.riskTolerance).toBe(0.4);
    expect(parsed.aliases).toHaveLength(1);
  });

  it('defaults aliases to an empty list and doctrineBase to an empty slice', () => {
    const parsed = ServiceDefinitionSchema.parse({
      id: 'stapo',
      name: 'State Police',
      kind: 'local-security',
      country: 'Austria',
    });
    expect(parsed.aliases).toEqual([]);
    expect(parsed.doctrineBase).toEqual({});
    expect(parsed.years).toBeUndefined();
    expect(parsed.tags).toBeUndefined();
  });

  it('exposes exactly the four service kinds', () => {
    expect([...SERVICE_KINDS]).toEqual([
      'own',
      'hostile',
      'local-security',
      'liaison',
    ]);
    for (const kind of SERVICE_KINDS) {
      expect(
        ServiceDefinitionSchema.safeParse({ ...ownService, kind }).success,
      ).toBe(true);
    }
  });

  it('rejects an unknown service kind', () => {
    expect(
      ServiceDefinitionSchema.safeParse({ ...ownService, kind: 'friendly' })
        .success,
    ).toBe(false);
  });

  it('rejects a doctrine dimension outside [0, 1]', () => {
    expect(
      ServiceDefinitionSchema.safeParse({
        ...ownService,
        doctrineBase: { riskTolerance: 1.5 },
      }).success,
    ).toBe(false);
  });

  it('rejects an unknown doctrine dimension (strict object)', () => {
    expect(
      ServiceDefinitionSchema.safeParse({
        ...ownService,
        doctrineBase: { aggression: 0.5 },
      }).success,
    ).toBe(false);
  });

  it('requires a non-empty name and country', () => {
    expect(
      ServiceDefinitionSchema.safeParse({ ...ownService, name: '' }).success,
    ).toBe(false);
    expect(
      ServiceDefinitionSchema.safeParse({ ...ownService, country: '' }).success,
    ).toBe(false);
  });

  it('rejects an inverted year range', () => {
    expect(
      ServiceDefinitionSchema.safeParse({
        ...ownService,
        years: { from: 1965, to: 1945 },
      }).success,
    ).toBe(false);
  });

  it('rejects an unknown top-level field (strict object)', () => {
    expect(
      ServiceDefinitionSchema.safeParse({ ...ownService, budget: 100 }).success,
    ).toBe(false);
  });
});

// --- registration ----------------------------------------------------------

describe('service kind registration (Req 17.1, 19.1)', () => {
  it('is allowed in Era and City Packs and is City-Scoped', () => {
    expect(serviceKind.kind).toBe('service');
    expect(serviceKind.dir).toBe('services');
    expect(serviceKind.roles).toEqual(['era', 'city']);
    expect(serviceKind.cityScoped).toBe(true);
    expect(serviceKind.owner).toContain('content');
  });

  it('declares its text, tag and year fields for the loader and linter', () => {
    expect(serviceKind.fields.text).toEqual([
      'items[].name',
      'items[].aliases[].text',
    ]);
    expect(serviceKind.fields.tags).toEqual(['items[].tags[]']);
    expect(serviceKind.fields.years).toEqual(['items[].years']);
  });
});
