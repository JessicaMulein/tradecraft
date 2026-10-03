/**
 * Unit tests for the predicate-derived Claim Extraction schema (Requirements
 * 7.1, 7.2, 32.3).
 *
 * The schema is generated from the loaded predicate definitions: one branch per
 * predicate, each constraining `subject` / `object` to the declared kinds and
 * `place` / `when` to the predicate's place and window rules. These tests pin
 * down that derivation — a legal Claim parses, an illegal one (wrong predicate,
 * wrong argument kind, a place where none is allowed) is rejected by the same
 * schema the Gateway re-validates against.
 */

import {
  compilePredicateRegistry,
  type PredicateDefinition,
  type PredicateRegistry,
} from '@tradecraft/content';
import { describe, expect, it } from 'vitest';

import { buildExtractionSchema, MAX_EXTRACTED_CLAIMS } from './schema.js';

const meetsAt: PredicateDefinition = {
  id: 'MEETS_AT',
  subject: ['npc', 'unk'],
  object: { entity: ['npc', 'unk'] },
  place: 'required',
  window: 'required',
  evaluator: 'fact-match',
  fieldCode: 'MT',
  render: {
    second: 'You meet {object} at {place} {when}.',
    third: '{subject} meets {object} at {place} {when}.',
  },
  extractorHint: 'Two people meet at a place.',
};

const pays: PredicateDefinition = {
  id: 'PAYS',
  subject: ['npc'],
  object: { literal: 'amount' },
  place: 'none',
  window: 'optional',
  evaluator: 'fact-match',
  fieldCode: 'PY',
  render: {
    second: 'You pay {object}.',
    third: '{subject} pays {object}.',
  },
  extractorHint: 'One person pays an amount.',
};

const worksFor: PredicateDefinition = {
  id: 'WORKS_FOR',
  subject: ['npc', 'unk'],
  object: { entity: ['org'] },
  place: 'none',
  window: 'none',
  evaluator: 'fact-match',
  fieldCode: 'WF',
  render: {
    second: 'You work for {object}.',
    third: '{subject} works for {object}.',
  },
  extractorHint: 'A person works for an organisation.',
};

function registryOf(defs: PredicateDefinition[]): PredicateRegistry {
  const result = compilePredicateRegistry(defs);
  if (!result.ok) throw new Error('expected the test predicates to compile');
  return result.registry;
}

describe('buildExtractionSchema branches (Req 32.3)', () => {
  it('accepts a well-formed entity Claim with required place and window', () => {
    const schema = buildExtractionSchema(registryOf([meetsAt]));
    const parsed = schema.parse({
      claims: [
        {
          predicate: 'MEETS_AT',
          subject: 'npc:ana',
          object: 'npc:viktor',
          place: 'loc:pier',
          when: { from: { day: 2, phase: 2 } },
          hedged: false,
        },
      ],
    });
    expect(parsed.claims).toHaveLength(1);
    expect(parsed.claims[0].predicate).toBe('MEETS_AT');
  });

  it('accepts the "unknown" sentinel for an entity argument', () => {
    const schema = buildExtractionSchema(registryOf([meetsAt]));
    const parsed = schema.parse({
      claims: [
        {
          predicate: 'MEETS_AT',
          subject: 'npc:ana',
          object: 'unknown',
          place: 'loc:pier',
          when: { from: { day: 0, phase: 0 } },
          hedged: true,
        },
      ],
    });
    expect(parsed.claims[0].object).toBe('unknown');
  });

  it('accepts a literal-object Claim', () => {
    const schema = buildExtractionSchema(registryOf([pays]));
    const parsed = schema.parse({
      claims: [
        {
          predicate: 'PAYS',
          subject: 'npc:ana',
          object: { kind: 'amount', value: 500 },
          hedged: false,
        },
      ],
    });
    const object = parsed.claims[0].object;
    expect(typeof object === 'object' && object.kind).toBe('amount');
  });

  it('rejects a predicate outside the registry', () => {
    const schema = buildExtractionSchema(registryOf([meetsAt, pays]));
    expect(() =>
      schema.parse({
        claims: [
          { predicate: 'NO_SUCH', subject: 'npc:ana', object: 'npc:v', hedged: false },
        ],
      }),
    ).toThrow();
  });

  it('rejects a place on a predicate whose place rule is none', () => {
    const schema = buildExtractionSchema(registryOf([worksFor]));
    expect(() =>
      schema.parse({
        claims: [
          {
            predicate: 'WORKS_FOR',
            subject: 'npc:ana',
            object: 'org:cell',
            place: 'loc:pier',
            hedged: false,
          },
        ],
      }),
    ).toThrow();
  });

  it('rejects an object whose kind the predicate does not allow', () => {
    const schema = buildExtractionSchema(registryOf([worksFor]));
    // WORKS_FOR takes an org object; an npc id is not allowed.
    expect(() =>
      schema.parse({
        claims: [
          { predicate: 'WORKS_FOR', subject: 'npc:ana', object: 'npc:viktor', hedged: false },
        ],
      }),
    ).toThrow();
  });

  it('rejects a missing required window', () => {
    const schema = buildExtractionSchema(registryOf([meetsAt]));
    expect(() =>
      schema.parse({
        claims: [
          {
            predicate: 'MEETS_AT',
            subject: 'npc:ana',
            object: 'npc:viktor',
            place: 'loc:pier',
            hedged: false,
          },
        ],
      }),
    ).toThrow();
  });

  it('rejects more than the maximum number of claims', () => {
    const schema = buildExtractionSchema(registryOf([worksFor]));
    const one = {
      predicate: 'WORKS_FOR',
      subject: 'npc:ana',
      object: 'org:cell',
      hedged: false,
    };
    const tooMany = Array.from({ length: MAX_EXTRACTED_CLAIMS + 1 }, () => one);
    expect(() => schema.parse({ claims: tooMany })).toThrow();
  });

  it('accepts an empty claim list', () => {
    const schema = buildExtractionSchema(registryOf([meetsAt, pays, worksFor]));
    expect(schema.parse({ claims: [] }).claims).toEqual([]);
  });
});

describe('buildExtractionSchema degenerate cases', () => {
  it('an empty registry only accepts the empty claim list', () => {
    const schema = buildExtractionSchema(registryOf([]));
    expect(schema.parse({ claims: [] }).claims).toEqual([]);
    expect(() =>
      schema.parse({
        claims: [{ predicate: 'X', subject: 'npc:a', object: 'npc:b', hedged: false }],
      }),
    ).toThrow();
  });

  it('a single-predicate registry parses that predicate', () => {
    const schema = buildExtractionSchema(registryOf([worksFor]));
    const parsed = schema.parse({
      claims: [
        { predicate: 'WORKS_FOR', subject: 'npc:ana', object: 'org:cell', hedged: false },
      ],
    });
    expect(parsed.claims[0].predicate).toBe('WORKS_FOR');
  });
});
