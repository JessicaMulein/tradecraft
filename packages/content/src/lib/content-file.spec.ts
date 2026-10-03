/**
 * Tests for the content-file envelope and its Provenance Record (task 1.1,
 * Requirement 16.2). The envelope lets a schema-2 file carry a Provenance
 * Record alongside its items; the bare-list form must keep working unchanged.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  ContentFileEnvelopeSchema,
  ProvenanceSchema,
  isContentFileEnvelope,
  normalizeContentFile,
} from '../index.js';

describe('ProvenanceSchema', () => {
  it('accepts a draft record from the Authoring Aid', () => {
    const parsed = ProvenanceSchema.parse({
      generated: true,
      model: 'local/mixtral',
      promptHash: 'abc123',
      generatedAt: '2024-01-02T03:04:05Z',
    });
    expect(parsed.generated).toBe(true);
    expect(parsed.reviewedBy).toBeUndefined();
  });

  it('accepts a promoted record with reviewer and review time', () => {
    const parsed = ProvenanceSchema.parse({
      generated: true,
      reviewedBy: 'ada',
      reviewedAt: '2024-01-03T00:00:00Z',
    });
    expect(parsed.reviewedBy).toBe('ada');
  });

  it('requires the generated flag', () => {
    expect(() => ProvenanceSchema.parse({ model: 'x' })).toThrow();
  });

  it('rejects an unknown field', () => {
    expect(() =>
      ProvenanceSchema.parse({ generated: false, extra: 1 }),
    ).toThrow();
  });
});

describe('ContentFileEnvelopeSchema', () => {
  it('accepts an envelope with provenance and items', () => {
    const parsed = ContentFileEnvelopeSchema.parse({
      provenance: { generated: false },
      items: [{ id: 'a' }, { id: 'b' }],
    });
    expect(parsed.items).toHaveLength(2);
    expect(parsed.provenance?.generated).toBe(false);
  });

  it('accepts an envelope with no provenance', () => {
    const parsed = ContentFileEnvelopeSchema.parse({ items: [] });
    expect(parsed.provenance).toBeUndefined();
  });

  it('rejects an envelope whose items is not a list', () => {
    expect(() =>
      ContentFileEnvelopeSchema.parse({ items: { id: 'a' } }),
    ).toThrow();
  });

  it('rejects an unknown extra key alongside items', () => {
    expect(() =>
      ContentFileEnvelopeSchema.parse({ items: [], note: 'x' }),
    ).toThrow();
  });
});

describe('isContentFileEnvelope', () => {
  it('is true only for an object carrying an items key', () => {
    expect(isContentFileEnvelope({ items: [] })).toBe(true);
    expect(isContentFileEnvelope({ provenance: { generated: false }, items: [] })).toBe(true);
  });

  it('is false for a bare list, a scalar, null and a mapping with no items', () => {
    expect(isContentFileEnvelope([{ id: 'a' }])).toBe(false);
    expect(isContentFileEnvelope('x')).toBe(false);
    expect(isContentFileEnvelope(null)).toBe(false);
    expect(isContentFileEnvelope({ id: 'a' })).toBe(false);
  });
});

describe('normalizeContentFile', () => {
  it('passes a bare list through with no provenance', () => {
    const result = normalizeContentFile([{ id: 'a' }, { id: 'b' }]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.items).toEqual([{ id: 'a' }, { id: 'b' }]);
      expect(result.value.provenance).toBeUndefined();
    }
  });

  it('unwraps an envelope into its items and provenance', () => {
    const result = normalizeContentFile({
      provenance: { generated: true, reviewedBy: 'ada', reviewedAt: '2024-01-01T00:00:00Z' },
      items: [{ id: 'a' }],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.items).toEqual([{ id: 'a' }]);
      expect(result.value.provenance?.generated).toBe(true);
    }
  });

  it('treats a single mapping with no items key as a one-item bare file', () => {
    const result = normalizeContentFile({ id: 'only' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.items).toEqual([{ id: 'only' }]);
    }
  });

  it('reads null or undefined as an empty file', () => {
    for (const empty of [null, undefined]) {
      const result = normalizeContentFile(empty);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.items).toEqual([]);
      }
    }
  });

  it('reports a malformed envelope as a Zod error', () => {
    const result = normalizeContentFile({ items: 'not-a-list' });
    expect(result.ok).toBe(false);
  });

  // Feature: content-expansion, Property: envelope and bare list carry the same items
  it('yields the same items whether a list is written bare or wrapped', () => {
    fc.assert(
      fc.property(
        fc.array(fc.record({ id: fc.string({ minLength: 1 }) }), { maxLength: 8 }),
        fc.option(fc.record({ generated: fc.boolean() }), { nil: undefined }),
        (items, provenance) => {
          const bare = normalizeContentFile(items);
          const wrapped = normalizeContentFile(
            provenance === undefined ? { items } : { provenance, items },
          );
          expect(bare.ok && wrapped.ok).toBe(true);
          if (bare.ok && wrapped.ok) {
            expect(wrapped.value.items).toEqual(bare.value.items);
            expect(wrapped.value.provenance).toEqual(provenance);
          }
        },
      ),
    );
  });
});
