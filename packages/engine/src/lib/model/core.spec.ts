import fc from 'fast-check';

import {
  asTruth,
  compareTime,
  coreJsonSchemas,
  ENTITY_NAMESPACES,
  EntityIdSchema,
  GameTimeSchema,
  isEntityId,
  jsonSchemaFor,
  LiteralSchema,
  PHASE_NAMES,
  PHASES_PER_DAY,
  phaseName,
  phaseOrdinal,
  PropositionSchema,
  revealTruth,
  timeToPhases,
  truthSchema,
  type EntityId,
  type GameTime,
  type Literal,
  type Phase,
  type Proposition,
} from './core.js';

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

const localId = fc
  .stringMatching(/^[A-Za-z0-9][A-Za-z0-9_-]*$/)
  .filter((s) => s.length > 0 && s.length < 24);

const nonUnkNamespace = fc.constantFrom('npc', 'loc', 'org', 'item', 'doc', 'chan');

const entityIdArb: fc.Arbitrary<EntityId> = fc.oneof(
  fc.tuple(nonUnkNamespace, localId).map(([ns, id]) => `${ns}:${id}` as EntityId),
  fc.nat().map((n) => `unk:${n}` as EntityId),
);

const phaseArb: fc.Arbitrary<Phase> = fc.constantFrom(0, 1, 2, 3);

const gameTimeArb: fc.Arbitrary<GameTime> = fc.record({
  day: fc.nat({ max: 10_000 }),
  phase: phaseArb,
});

const literalArb: fc.Arbitrary<Literal> = fc.oneof(
  fc.record({ kind: fc.constant('text' as const), value: fc.string() }),
  fc.record({ kind: fc.constant('amount' as const), value: fc.double({ noNaN: true, noDefaultInfinity: true }) }),
  fc.record({ kind: fc.constant('time' as const), value: gameTimeArb }),
);

const propositionArb: fc.Arbitrary<Proposition> = fc.record(
  {
    id: fc.string({ minLength: 1 }).filter((s) => s.length > 0),
    subject: entityIdArb,
    predicate: fc.constantFrom('core/MEETS_AT', 'core/MEMBER_OF', 'core/KNOWS'),
    object: fc.oneof(entityIdArb, literalArb),
    place: fc.option(
      localId.map((id) => `loc:${id}` as const),
      { nil: undefined },
    ),
    window: fc.option(
      fc.record(
        { from: gameTimeArb, to: fc.option(gameTimeArb, { nil: undefined }) },
        { requiredKeys: ['from'] },
      ),
      { nil: undefined },
    ),
  },
  { requiredKeys: ['id', 'subject', 'predicate', 'object'] },
);

// ---------------------------------------------------------------------------
// Entity ids
// ---------------------------------------------------------------------------

describe('EntityId', () => {
  it('accepts a well-formed id in every namespace', () => {
    expect(isEntityId('npc:ana')).toBe(true);
    expect(isEntityId('loc:pier')).toBe(true);
    expect(isEntityId('org:station')).toBe(true);
    expect(isEntityId('item:film-canister')).toBe(true);
    expect(isEntityId('doc:cable-01')).toBe(true);
    expect(isEntityId('chan:numbers-3')).toBe(true);
    expect(isEntityId('unk:3')).toBe(true);
  });

  it('covers doc:, chan: and unk: as the task calls out', () => {
    for (const id of ['doc:brief', 'chan:radio-7', 'unk:0', 'unk:42']) {
      expect(() => EntityIdSchema.parse(id)).not.toThrow();
    }
  });

  it('rejects unknown namespaces, empty locals and malformed ids', () => {
    for (const bad of [
      'who:ana',
      'npc:',
      ':ana',
      'ana',
      'npc:ana:extra',
      'npc: ana',
      'loc:/slash',
    ]) {
      expect(isEntityId(bad)).toBe(false);
      expect(() => EntityIdSchema.parse(bad)).toThrow();
    }
  });

  it('requires unk: locals to be plain non-negative integers', () => {
    expect(isEntityId('unk:3')).toBe(true);
    expect(isEntityId('unk:0')).toBe(true);
    // Leading zero, negative and non-numeric unk locals are not valid.
    expect(isEntityId('unk:03')).toBe(false);
    expect(isEntityId('unk:-1')).toBe(false);
    expect(isEntityId('unk:abc')).toBe(false);
  });

  it('parses every generated id and round-trips the string', () => {
    fc.assert(
      fc.property(entityIdArb, (id) => {
        expect(isEntityId(id)).toBe(true);
        expect(EntityIdSchema.parse(id)).toBe(id);
      }),
    );
  });

  it('lists exactly the seven design namespaces', () => {
    expect([...ENTITY_NAMESPACES]).toEqual([
      'npc',
      'loc',
      'org',
      'item',
      'doc',
      'chan',
      'unk',
    ]);
  });
});

// ---------------------------------------------------------------------------
// Game time
// ---------------------------------------------------------------------------

describe('GameTime', () => {
  it('names the four phases in order', () => {
    expect([...PHASE_NAMES]).toEqual(['morning', 'afternoon', 'evening', 'night']);
    expect(PHASES_PER_DAY).toBe(4);
  });

  it('maps phase ordinals to names and back', () => {
    for (let p = 0 as Phase; p < 4; p = (p + 1) as Phase) {
      expect(phaseOrdinal(phaseName(p))).toBe(p);
    }
    expect(phaseOrdinal('dawn')).toBeUndefined();
  });

  it('parses a valid time and rejects bad phases and days', () => {
    expect(() => GameTimeSchema.parse({ day: 0, phase: 0 })).not.toThrow();
    expect(() => GameTimeSchema.parse({ day: 3, phase: 3 })).not.toThrow();
    expect(() => GameTimeSchema.parse({ day: -1, phase: 0 })).toThrow();
    expect(() => GameTimeSchema.parse({ day: 1.5, phase: 0 })).toThrow();
    expect(() => GameTimeSchema.parse({ day: 0, phase: 4 })).toThrow();
    expect(() => GameTimeSchema.parse({ day: 0, phase: 0, extra: 1 })).toThrow();
  });

  it('orders times consistently with their phase totals', () => {
    fc.assert(
      fc.property(gameTimeArb, gameTimeArb, (a, b) => {
        expect(Math.sign(compareTime(a, b))).toBe(
          Math.sign(timeToPhases(a) - timeToPhases(b)),
        );
      }),
    );
  });

  it('treats a day boundary as four phases', () => {
    expect(compareTime({ day: 1, phase: 0 }, { day: 0, phase: 3 })).toBeGreaterThan(0);
    expect(timeToPhases({ day: 2, phase: 1 })).toBe(2 * 4 + 1);
  });
});

// ---------------------------------------------------------------------------
// Literal and Proposition
// ---------------------------------------------------------------------------

describe('Proposition', () => {
  it('accepts an entity object, a place and a window', () => {
    const p: Proposition = {
      id: 'p1',
      subject: 'npc:ana',
      predicate: 'core/MEETS_AT',
      object: 'npc:viktor',
      place: 'loc:pier',
      window: { from: { day: 1, phase: 2 } },
    };
    expect(() => PropositionSchema.parse(p)).not.toThrow();
  });

  it('accepts a literal object and omits the optional place', () => {
    const p: Proposition = {
      id: 'p2',
      subject: 'npc:ana',
      predicate: 'core/PAID',
      object: { kind: 'amount', value: 500 },
    };
    const parsed = PropositionSchema.parse(p);
    expect(parsed.place).toBeUndefined();
    expect(parsed.object).toEqual({ kind: 'amount', value: 500 });
  });

  it('rejects a non-Location place and an unknown literal kind', () => {
    expect(() =>
      PropositionSchema.parse({
        id: 'p3',
        subject: 'npc:ana',
        predicate: 'core/MEETS_AT',
        object: 'npc:viktor',
        place: 'npc:viktor',
      }),
    ).toThrow();
    expect(() => LiteralSchema.parse({ kind: 'date', value: 1 })).toThrow();
  });

  it('parses every generated Proposition without loss', () => {
    fc.assert(
      fc.property(propositionArb, (p) => {
        expect(PropositionSchema.parse(p)).toEqual(p);
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// Truth<T>
// ---------------------------------------------------------------------------

describe('Truth<T>', () => {
  it('carries the wrapped value unchanged at runtime', () => {
    const prop: Proposition = {
      id: 'p4',
      subject: 'org:cell',
      predicate: 'core/PLANS',
      object: { kind: 'text', value: 'the drop' },
    };
    const truth = asTruth(prop);
    expect(revealTruth(truth)).toBe(prop);
    expect(JSON.parse(JSON.stringify(truth))).toEqual(prop);
  });

  it('parses through a truth schema with the brand erased', () => {
    const schema = truthSchema(GameTimeSchema);
    const value = schema.parse({ day: 4, phase: 1 });
    expect(revealTruth(value)).toEqual({ day: 4, phase: 1 });
  });
});

// ---------------------------------------------------------------------------
// JSON Schema exports
// ---------------------------------------------------------------------------

describe('JSON Schema exports', () => {
  it('produces a schema for every named core type', () => {
    const schemas = coreJsonSchemas();
    expect(Object.keys(schemas).sort()).toEqual(
      ['EntityId', 'GameTime', 'Literal', 'Phase', 'Proposition', 'TimeWindow'].sort(),
    );
    for (const schema of Object.values(schemas)) {
      expect(schema).toBeTypeOf('object');
    }
  });

  // Each named schema carries a `.meta({ id })`, so Zod emits a top-level
  // `$ref` into `$defs`. `rootDef` follows that ref to the definition body.
  function rootDef(schema: unknown): Record<string, unknown> {
    const doc = schema as {
      $ref?: string;
      $defs?: Record<string, Record<string, unknown>>;
    };
    if (doc.$ref && doc.$defs) {
      const name = doc.$ref.replace('#/$defs/', '');
      return doc.$defs[name];
    }
    return doc as Record<string, unknown>;
  }

  it('exports a GameTime object schema with day and phase', () => {
    const def = rootDef(jsonSchemaFor('GameTime')) as {
      type?: string;
      properties?: Record<string, unknown>;
      required?: string[];
    };
    expect(def.type).toBe('object');
    expect(Object.keys(def.properties ?? {}).sort()).toEqual(['day', 'phase']);
    expect(def.required).toEqual(expect.arrayContaining(['day', 'phase']));
  });

  it('exports an EntityId string schema', () => {
    const def = rootDef(jsonSchemaFor('EntityId')) as { type?: string };
    expect(def.type).toBe('string');
  });
});
