/**
 * Field-message encode/parse tests.
 *
 * These cover {@link encodePropositions} and {@link parseFieldMessage}: the
 * terse, predicate-keyed plaintext the Cipher Engine enciphers (Requirement
 * 9.1), and the predicate-derived round-trip they must honour (Requirement
 * 32.3). The exhaustive property form of the round-trip is Property 25 in task
 * 8.7; here we pin the grammar with worked examples and a focused round-trip
 * property across the shapes a Proposition can take — entity and literal
 * objects, with and without place and window, across several predicates.
 *
 * The registry is stood up with a small hand-built field-code map. The real
 * `compilePredicateRegistry` exposes exactly a `fieldCodes: Map<id, code>`, so
 * both the whole-registry-shaped object and the bare map are exercised.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import type { Literal, Proposition } from '../model/core.js';

import {
  encodePropositions,
  parseFieldMessage,
  type FieldCodeSource,
} from './field-message.js';

// ---------------------------------------------------------------------------
// A small predicate vocabulary for the tests
// ---------------------------------------------------------------------------

// Predicate id → field code, matching the shape `registry.fieldCodes` has.
const FIELD_CODES = new Map<string, string>([
  ['core/MEETS_AT', 'MAT'],
  ['core/MOVES_MATERIEL', 'MAT2'],
  ['core/PAYS', 'PAY'],
  ['core/KNOWS', 'KN'],
  ['core/TRANSMITS_AT', 'TX'],
]);

// A whole-registry-shaped source and the bare map, so both inputs are tested.
const registry: FieldCodeSource = { fieldCodes: FIELD_CODES };
const bareMap: FieldCodeSource = FIELD_CODES;

/** Reconstruct the id the parser assigns a Proposition at line `index`. */
function withParsedId(prop: Proposition, index: number): Proposition {
  return { ...prop, id: `fm:${index}` };
}

// ---------------------------------------------------------------------------
// Worked grammar examples
// ---------------------------------------------------------------------------

describe('encodePropositions grammar', () => {
  it('encodes an entity-object proposition as "<CODE> <subject> <object>"', () => {
    const prop: Proposition = {
      id: 'p1',
      subject: 'npc:ana',
      predicate: 'core/KNOWS',
      object: 'npc:boris',
    };
    expect(encodePropositions([prop], registry)).toBe('KN npc:ana npc:boris');
  });

  it('appends @place and ~window when present', () => {
    const prop: Proposition = {
      id: 'p1',
      subject: 'npc:ana',
      predicate: 'core/MEETS_AT',
      object: 'npc:boris',
      place: 'loc:cafe',
      window: { from: { day: 2, phase: 1 }, to: { day: 2, phase: 3 } },
    };
    expect(encodePropositions([prop], registry)).toBe(
      'MAT npc:ana npc:boris @loc:cafe ~2.1..2.3',
    );
  });

  it('writes an open-ended window with no "to"', () => {
    const prop: Proposition = {
      id: 'p1',
      subject: 'npc:ana',
      predicate: 'core/TRANSMITS_AT',
      object: 'chan:short-wave',
      window: { from: { day: 0, phase: 0 } },
    };
    expect(encodePropositions([prop], registry)).toBe(
      'TX npc:ana chan:short-wave ~0.0',
    );
  });

  it('tags text, amount and time literals distinctly from entity ids', () => {
    const text: Proposition = {
      id: 'p',
      subject: 'npc:ana',
      predicate: 'core/KNOWS',
      object: { kind: 'text', value: 'the drop is live' },
    };
    const amount: Proposition = {
      id: 'p',
      subject: 'org:station',
      predicate: 'core/PAYS',
      object: { kind: 'amount', value: 500 },
    };
    const time: Proposition = {
      id: 'p',
      subject: 'npc:ana',
      predicate: 'core/TRANSMITS_AT',
      object: { kind: 'time', value: { day: 3, phase: 2 } },
    };
    expect(encodePropositions([text], registry)).toBe(
      'KN npc:ana =T:the\\sdrop\\sis\\slive',
    );
    expect(encodePropositions([amount], registry)).toBe('PAY org:station =A:500');
    expect(encodePropositions([time], registry)).toBe('TX npc:ana =M:3.2');
  });

  it('puts one proposition per line, in order', () => {
    const props: Proposition[] = [
      { id: 'a', subject: 'npc:ana', predicate: 'core/KNOWS', object: 'npc:boris' },
      { id: 'b', subject: 'org:station', predicate: 'core/PAYS', object: { kind: 'amount', value: 10 } },
    ];
    expect(encodePropositions(props, registry)).toBe(
      'KN npc:ana npc:boris\nPAY org:station =A:10',
    );
  });

  it('encodes an empty list as the empty string', () => {
    expect(encodePropositions([], registry)).toBe('');
  });

  it('throws when a predicate has no field code', () => {
    const prop: Proposition = {
      id: 'p',
      subject: 'npc:ana',
      predicate: 'core/UNKNOWN',
      object: 'npc:boris',
    };
    expect(() => encodePropositions([prop], registry)).toThrow(/no field code/);
  });

  it('rejects a non-finite amount literal', () => {
    const prop: Proposition = {
      id: 'p',
      subject: 'org:station',
      predicate: 'core/PAYS',
      object: { kind: 'amount', value: Number.POSITIVE_INFINITY },
    };
    expect(() => encodePropositions([prop], registry)).toThrow(/finite number/);
  });
});

// ---------------------------------------------------------------------------
// Parsing: inverse and error cases
// ---------------------------------------------------------------------------

describe('parseFieldMessage', () => {
  it('parses a full line back into a Proposition with an fm: id', () => {
    const [prop] = parseFieldMessage(
      'MAT npc:ana npc:boris @loc:cafe ~2.1..2.3',
      registry,
    );
    expect(prop).toEqual({
      id: 'fm:0',
      subject: 'npc:ana',
      predicate: 'core/MEETS_AT',
      object: 'npc:boris',
      place: 'loc:cafe',
      window: { from: { day: 2, phase: 1 }, to: { day: 2, phase: 3 } },
    });
  });

  it('parses the empty string as an empty list', () => {
    expect(parseFieldMessage('', registry)).toEqual([]);
  });

  it('reads field codes against the registry (bare map accepted)', () => {
    const [prop] = parseFieldMessage('KN npc:ana npc:boris', bareMap);
    expect(prop.predicate).toBe('core/KNOWS');
  });

  it('throws on an unknown field code', () => {
    expect(() => parseFieldMessage('ZZZ npc:ana npc:boris', registry)).toThrow(
      /unknown field code/,
    );
  });

  it('throws on too few fields', () => {
    expect(() => parseFieldMessage('KN npc:ana', registry)).toThrow(
      /too few fields/,
    );
  });

  it('throws on a bad entity id', () => {
    expect(() => parseFieldMessage('KN not-an-id npc:boris', registry)).toThrow(
      /valid entity id/,
    );
  });

  it('throws when a place is not a loc: id', () => {
    expect(() =>
      parseFieldMessage('KN npc:ana npc:boris @npc:boris', registry),
    ).toThrow(/not a loc:/);
  });

  it('throws on an unknown literal tag', () => {
    expect(() => parseFieldMessage('KN npc:ana =Z:boom', registry)).toThrow(
      /unknown literal tag/,
    );
  });

  it('throws on a non-numeric amount literal', () => {
    expect(() => parseFieldMessage('PAY org:station =A:lots', registry)).toThrow(
      /non-numeric amount/,
    );
  });

  it('throws on a malformed time', () => {
    expect(() =>
      parseFieldMessage('TX npc:ana =M:threeish', registry),
    ).toThrow(/not "<day>\.<phase>"/);
  });

  it('throws on an out-of-range phase', () => {
    expect(() => parseFieldMessage('TX npc:ana =M:3.9', registry)).toThrow(
      /bad phase/,
    );
  });
});

// ---------------------------------------------------------------------------
// Round-trip property (Req 32.3)
// ---------------------------------------------------------------------------

describe('predicate-derived round-trip (Req 32.3)', () => {
  const predicateIds = [...FIELD_CODES.keys()];

  const entityIdArb: fc.Arbitrary<string> = fc.oneof(
    fc
      .string({
        unit: fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789'.split('')),
        minLength: 1,
        maxLength: 8,
      })
      .map((local) => `npc:${local}`),
    fc
      .string({
        unit: fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789'.split('')),
        minLength: 1,
        maxLength: 8,
      })
      .map((local) => `org:${local}`),
    fc.nat({ max: 999 }).map((n) => `unk:${n}`),
    fc
      .string({
        unit: fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789'.split('')),
        minLength: 1,
        maxLength: 8,
      })
      .map((local) => `chan:${local}`),
  );

  const locIdArb: fc.Arbitrary<`loc:${string}`> = fc
    .string({
      unit: fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789'.split('')),
      minLength: 1,
      maxLength: 8,
    })
    .map((local) => `loc:${local}` as `loc:${string}`);

  const gameTimeArb = fc.record({
    day: fc.nat({ max: 400 }),
    phase: fc.constantFrom(0, 1, 2, 3) as fc.Arbitrary<0 | 1 | 2 | 3>,
  });

  // Text with the full range of grammar-breaking characters: spaces, newlines,
  // tabs, carriage returns, backslashes and the sigils themselves.
  const textArb = fc.string({
    unit: fc.constantFrom(
      ...'abc XYZ 123 @~=:.\\'.split(''),
      ' ',
      '\n',
      '\r',
      '\t',
    ),
    minLength: 0,
    maxLength: 24,
  });

  const literalArb: fc.Arbitrary<Literal> = fc.oneof(
    textArb.map((value) => ({ kind: 'text', value }) as const),
    fc
      .oneof(
        fc.integer({ min: -1_000_000, max: 1_000_000 }),
        fc.double({ noNaN: true, noDefaultInfinity: true }),
      )
      // `-0` serialises as "0" and parses back to `+0`; `toEqual` distinguishes
      // the two, and the Sim never carries a signed zero amount, so drop it.
      .filter((value) => !Object.is(value, -0))
      .map((value) => ({ kind: 'amount', value }) as const),
    gameTimeArb.map((value) => ({ kind: 'time', value }) as const),
  );

  const objectArb = fc.oneof(entityIdArb, literalArb);

  const windowArb = fc.oneof(
    gameTimeArb.map((from) => ({ from })),
    fc.tuple(gameTimeArb, gameTimeArb).map(([from, to]) => ({ from, to })),
  );

  const propositionArb: fc.Arbitrary<Proposition> = fc.record(
    {
      id: fc.constant('ignored'),
      subject: entityIdArb as fc.Arbitrary<Proposition['subject']>,
      predicate: fc.constantFrom(...predicateIds),
      object: objectArb as fc.Arbitrary<Proposition['object']>,
      place: fc.option(locIdArb, { nil: undefined }),
      window: fc.option(windowArb, { nil: undefined }),
    },
    { requiredKeys: ['id', 'subject', 'predicate', 'object'] },
  );

  it('parseFieldMessage(encodePropositions(props)) equals props (ids aside)', () => {
    fc.assert(
      fc.property(fc.array(propositionArb, { maxLength: 6 }), (props) => {
        const encoded = encodePropositions(props, registry);
        const parsed = parseFieldMessage(encoded, registry);
        const expected = props.map((p, i) => withParsedId(p, i));
        expect(parsed).toEqual(expected);
      }),
      { numRuns: 500 },
    );
  });

  it('round-trips a single proposition for every predicate', () => {
    fc.assert(
      fc.property(propositionArb, (prop) => {
        const encoded = encodePropositions([prop], registry);
        const [parsed] = parseFieldMessage(encoded, registry);
        expect(parsed).toEqual(withParsedId(prop, 0));
      }),
      { numRuns: 500 },
    );
  });

  it('produces exactly one line per proposition (no stray newlines)', () => {
    fc.assert(
      fc.property(
        fc.array(propositionArb, { minLength: 1, maxLength: 6 }),
        (props) => {
          const encoded = encodePropositions(props, registry);
          expect(encoded.split('\n')).toHaveLength(props.length);
        },
      ),
      { numRuns: 200 },
    );
  });
});
