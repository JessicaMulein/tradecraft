import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  AliasSchema,
  EntityRegistry,
  EntityRegistryDataSchema,
  type Alias,
  type EntityEntry,
  type EntityId,
} from '../../index.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const sample: EntityEntry[] = [
  {
    id: 'npc:viktor',
    canonicalName: 'Viktor Lang',
    aliases: [
      { text: 'the Austrian', distinctive: true },
      { text: 'Herr Lang', distinctive: true },
      { text: 'the man', distinctive: false },
    ],
  },
  {
    id: 'loc:pier',
    canonicalName: 'The Pier',
    aliases: [{ text: 'pier', distinctive: false }],
  },
  {
    id: 'loc:cafe',
    canonicalName: 'Café Mozart',
    aliases: [],
  },
];

// ---------------------------------------------------------------------------
// Alias schema
// ---------------------------------------------------------------------------

describe('AliasSchema', () => {
  it('accepts an alias with a distinctive flag', () => {
    const alias: Alias = { text: 'the Austrian', distinctive: true };
    expect(AliasSchema.parse(alias)).toEqual(alias);
  });

  it('trims surrounding whitespace from the text', () => {
    expect(AliasSchema.parse({ text: '  Herr Lang  ', distinctive: false })).toEqual({
      text: 'Herr Lang',
      distinctive: false,
    });
  });

  it('rejects blank text', () => {
    expect(() => AliasSchema.parse({ text: '   ', distinctive: true })).toThrow();
  });

  it('rejects a missing distinctive flag', () => {
    expect(() => AliasSchema.parse({ text: 'Lang' })).toThrow();
  });

  it('rejects unknown keys', () => {
    expect(() =>
      AliasSchema.parse({ text: 'Lang', distinctive: true, extra: 1 }),
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Registry data schema
// ---------------------------------------------------------------------------

describe('EntityRegistryDataSchema', () => {
  it('defaults a missing aliases list to empty', () => {
    const parsed = EntityRegistryDataSchema.parse([
      { id: 'loc:cafe', canonicalName: 'Café Mozart' },
    ]);
    expect(parsed[0].aliases).toEqual([]);
  });

  it('rejects a blank canonical name', () => {
    expect(() =>
      EntityRegistryDataSchema.parse([{ id: 'npc:x', canonicalName: '  ' }]),
    ).toThrow();
  });

  it('rejects a malformed entity id', () => {
    expect(() =>
      EntityRegistryDataSchema.parse([{ id: 'not-an-id', canonicalName: 'X' }]),
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Registry construction and lookup
// ---------------------------------------------------------------------------

describe('EntityRegistry', () => {
  it('builds from entries and reports its size and ids', () => {
    const registry = EntityRegistry.from(sample);
    expect(registry.size).toBe(3);
    expect(registry.ids()).toEqual(['npc:viktor', 'loc:pier', 'loc:cafe']);
  });

  it('parses untrusted data', () => {
    const registry = EntityRegistry.parse([
      { id: 'npc:x', canonicalName: 'Agent X' },
    ]);
    expect(registry.canonicalName('npc:x')).toBe('Agent X');
  });

  it('rejects a duplicate entity id', () => {
    expect(() =>
      EntityRegistry.from([
        { id: 'npc:x', canonicalName: 'One', aliases: [] },
        { id: 'npc:x', canonicalName: 'Two', aliases: [] },
      ]),
    ).toThrow(/duplicate id: npc:x/);
  });

  it('looks up canonical names and entries', () => {
    const registry = EntityRegistry.from(sample);
    expect(registry.canonicalName('npc:viktor')).toBe('Viktor Lang');
    expect(registry.entry('loc:pier')?.canonicalName).toBe('The Pier');
    expect(registry.has('loc:cafe')).toBe(true);
  });

  it('returns undefined/empty for an unregistered id', () => {
    const registry = EntityRegistry.from(sample);
    const absent = 'npc:ghost' as EntityId;
    expect(registry.has(absent)).toBe(false);
    expect(registry.entry(absent)).toBeUndefined();
    expect(registry.canonicalName(absent)).toBeUndefined();
    expect(registry.aliasesOf(absent)).toEqual([]);
    expect(registry.distinctiveAliasesOf(absent)).toEqual([]);
  });

  it('folds the canonical name in as the first distinctive alias', () => {
    const registry = EntityRegistry.from(sample);
    const aliases = registry.aliasesOf('npc:viktor');
    expect(aliases[0]).toEqual({ text: 'Viktor Lang', distinctive: true });
    expect(aliases).toContainEqual({ text: 'the Austrian', distinctive: true });
    expect(aliases).toContainEqual({ text: 'the man', distinctive: false });
  });

  it('does not duplicate the canonical name when an alias repeats it', () => {
    const registry = EntityRegistry.from([
      {
        id: 'loc:pier',
        canonicalName: 'The Pier',
        aliases: [{ text: 'the pier', distinctive: true }],
      },
    ]);
    const texts = registry.aliasesOf('loc:pier').map((a) => a.text);
    expect(texts).toEqual(['The Pier']);
  });

  describe('distinctiveAliasesOf (Leak Guard surface forms, Req 5.2)', () => {
    it('includes the canonical name and distinctive aliases only', () => {
      const registry = EntityRegistry.from(sample);
      expect(registry.distinctiveAliasesOf('npc:viktor')).toEqual([
        'Viktor Lang',
        'the Austrian',
        'Herr Lang',
      ]);
    });

    it('skips a generic alias such as "pier" for "The Pier"', () => {
      const registry = EntityRegistry.from(sample);
      const distinctive = registry.distinctiveAliasesOf('loc:pier');
      expect(distinctive).toEqual(['The Pier']);
      expect(distinctive).not.toContain('pier');
    });

    it('returns just the canonical name when there are no aliases', () => {
      const registry = EntityRegistry.from(sample);
      expect(registry.distinctiveAliasesOf('loc:cafe')).toEqual(['Café Mozart']);
    });
  });
});

// ---------------------------------------------------------------------------
// Property-based tests
// ---------------------------------------------------------------------------

const idArb: fc.Arbitrary<EntityId> = fc
  .tuple(
    fc.constantFrom('npc', 'loc', 'org', 'item', 'doc', 'chan'),
    fc.stringMatching(/^[A-Za-z0-9][A-Za-z0-9_-]*$/).filter((s) => s.length > 0 && s.length < 16),
  )
  .map(([ns, local]) => `${ns}:${local}` as EntityId);

const nameArb = fc
  .string({ minLength: 1 })
  .map((s) => s.trim())
  .filter((s) => s.length > 0);

const aliasArb: fc.Arbitrary<Alias> = fc.record({
  text: nameArb,
  distinctive: fc.boolean(),
});

const entryArb: fc.Arbitrary<EntityEntry> = fc.record({
  id: idArb,
  canonicalName: nameArb,
  aliases: fc.array(aliasArb, { maxLength: 6 }),
});

/** A list of entries with unique ids, so `from` never rejects. */
const dataArb: fc.Arbitrary<EntityEntry[]> = fc
  .uniqueArray(entryArb, {
    maxLength: 8,
    selector: (entry) => entry.id,
  });

describe('EntityRegistry properties', () => {
  it('every distinctive alias is a real surface form of the entity', () => {
    fc.assert(
      fc.property(dataArb, (data) => {
        const registry = EntityRegistry.from(data);
        for (const entry of data) {
          const distinctive = registry.distinctiveAliasesOf(entry.id);
          // The canonical name is always a distinctive surface form.
          expect(distinctive).toContain(entry.canonicalName);
          // Nothing generic leaks into the distinctive set. A text that appears
          // as *both* a distinctive and a generic alias is a legitimate
          // distinctive surface form (aliasesOf de-dupes case-insensitively,
          // first occurrence winning), so only texts that are generic *and not*
          // also distinctive count as "generic-only".
          const distinctiveKeys = new Set(
            distinctive.map((t) => t.toLowerCase()),
          );
          const genericOnly = entry.aliases
            .filter((a) => !a.distinctive)
            .map((a) => a.text.toLowerCase())
            .filter((t) => !distinctiveKeys.has(t));
          for (const text of distinctive) {
            if (text === entry.canonicalName) continue;
            expect(genericOnly).not.toContain(text.toLowerCase());
          }
        }
      }),
    );
  });

  it('aliasesOf has no duplicate (case-insensitive) surface forms', () => {
    fc.assert(
      fc.property(dataArb, (data) => {
        const registry = EntityRegistry.from(data);
        for (const entry of data) {
          const keys = registry.aliasesOf(entry.id).map((a) => a.text.toLowerCase());
          expect(new Set(keys).size).toBe(keys.length);
        }
      }),
    );
  });

  it('round-trips through the data schema', () => {
    fc.assert(
      fc.property(dataArb, (data) => {
        const parsed = EntityRegistryDataSchema.parse(data);
        const registry = EntityRegistry.from(parsed);
        expect(registry.size).toBe(data.length);
        for (const entry of data) {
          expect(registry.canonicalName(entry.id)).toBe(entry.canonicalName);
        }
      }),
    );
  });
});
