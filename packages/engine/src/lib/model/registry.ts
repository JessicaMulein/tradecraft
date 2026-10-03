/**
 * The Entity Registry: for every {@link EntityId} in a generated world, the
 * entity's canonical name and the aliases it may be referred to by, each alias
 * flagged distinctive or generic.
 *
 * The registry is the data the Leak Guard reads (Requirement 5.2). The guard
 * scans model output sentence by sentence and must release a sentence only when
 * it names no entity outside an allowed set. To do that soundly it needs to
 * know, for each entity, the surface forms that identify it — and which of
 * those forms are safe to ignore. "The Pier" is a distinctive name for a
 * Location; the bare word "pier" is generic and would match ordinary prose, so
 * it is flagged generic and skipped. Only distinctive aliases gate the stream.
 *
 * This module is pure data plus lookup. It mints no ids and reads no ground
 * truth, so a registry can be built during world generation and then handed to
 * the Player View and the dialogue pipeline alike; it carries names, never
 * allegiances or concealed Propositions. The guard itself (its matching and
 * retry logic) lands in a later task; this task provides the store it reads.
 */

import { z } from 'zod';

import { EntityIdSchema, type EntityId } from './core.js';

// ---------------------------------------------------------------------------
// Alias
// ---------------------------------------------------------------------------

/**
 * One surface form an entity may be named by, with the flag the Leak Guard
 * keys on. Matches the `Alias` type the design references on `Location` and
 * `Npc` (`aliases: Alias[]`).
 *
 * - `text` is the alias as written. Matching is case-insensitive and
 *   whole-word, so the stored casing is for display only.
 * - `distinctive` marks an alias that identifies the entity on its own. A
 *   distinctive alias gates the Leak Guard; a generic one (`distinctive:
 *   false`) is a common word that happens to appear in the name and is skipped,
 *   so that "pier" does not trip the guard for a Location called "The Pier".
 */
export interface Alias {
  readonly text: string;
  readonly distinctive: boolean;
}

/**
 * The non-empty, non-blank constraint on an alias' text. An alias of only
 * whitespace could never match a whole word, and an empty one is almost
 * certainly a data error, so both are rejected at parse time.
 */
const aliasText = z
  .string()
  .trim()
  .min(1, 'alias text must not be blank');

export const AliasSchema: z.ZodType<Alias> = z
  .strictObject({
    text: aliasText,
    distinctive: z.boolean(),
  })
  .meta({
    id: 'Alias',
    description:
      "A surface form naming an entity, flagged distinctive (identifies the " +
      'entity on its own) or generic (a common word, skipped by the Leak Guard).',
  });

// ---------------------------------------------------------------------------
// Entity entry
// ---------------------------------------------------------------------------

/**
 * One entity's record in the registry: its canonical name and every alias it
 * may be named by. The canonical name is the primary label used in Fact Lines
 * and views; the aliases are the alternative forms the guard must also watch
 * for. The canonical name is not duplicated into `aliases` — {@link
 * EntityRegistry.aliasesOf} folds it in as a distinctive alias, so callers that
 * want "all distinctive surface forms" get the canonical name too.
 */
export interface EntityEntry {
  readonly id: EntityId;
  readonly canonicalName: string;
  readonly aliases: readonly Alias[];
}

const canonicalName = z
  .string()
  .trim()
  .min(1, 'canonical name must not be blank');

export const EntityEntrySchema: z.ZodType<EntityEntry> = z
  .strictObject({
    id: EntityIdSchema,
    canonicalName,
    aliases: z.array(AliasSchema).default([]),
  })
  .meta({
    id: 'EntityEntry',
    description:
      "An entity's canonical name and its aliases, each flagged distinctive or generic.",
  });

/**
 * The serialised registry: a list of entries. A plain array (rather than a
 * record keyed by id) keeps the on-disk form order-stable and lets Zod report a
 * duplicate id with its array index. {@link EntityRegistry.from} turns it into
 * the indexed runtime structure.
 */
export const EntityRegistryDataSchema = z
  .array(EntityEntrySchema)
  .meta({ id: 'EntityRegistryData' });

export type EntityRegistryData = z.infer<typeof EntityRegistryDataSchema>;

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

/**
 * Normalise an alias or name for matching: trim and lower-case. Matching is
 * case-insensitive (design: "case-insensitive, whole-word match"), so the key
 * a lookup compares against is the lower-cased text. Display always uses the
 * stored, original-cased string.
 */
function matchKey(text: string): string {
  return text.trim().toLowerCase();
}

/**
 * The runtime Entity Registry. Built once from {@link EntityRegistryData} and
 * then read many times by the Player View and the dialogue pipeline. It is
 * immutable: a world's names are fixed at generation, and keeping the registry
 * read-only means a view projection cannot mutate shared state.
 */
export class EntityRegistry {
  private readonly entries: ReadonlyMap<EntityId, EntityEntry>;

  private constructor(entries: Map<EntityId, EntityEntry>) {
    this.entries = entries;
  }

  /**
   * Build a registry from entries, rejecting a duplicate entity id. Duplicate
   * ids are a data error: two records for one entity would make "the aliases of
   * `npc:x`" ambiguous, and the Leak Guard could then read the wrong set.
   */
  static from(data: EntityRegistryData): EntityRegistry {
    const entries = new Map<EntityId, EntityEntry>();
    for (const entry of data) {
      if (entries.has(entry.id)) {
        throw new Error(`Entity registry has a duplicate id: ${entry.id}`);
      }
      entries.set(entry.id, entry);
    }
    return new EntityRegistry(entries);
  }

  /** Parse untrusted data (a save file, generated world) into a registry. */
  static parse(data: unknown): EntityRegistry {
    return EntityRegistry.from(EntityRegistryDataSchema.parse(data));
  }

  /** True when the registry has an entry for `id`. */
  has(id: EntityId): boolean {
    return this.entries.has(id);
  }

  /** The entry for `id`, or `undefined` if the entity is unregistered. */
  entry(id: EntityId): EntityEntry | undefined {
    return this.entries.get(id);
  }

  /** The ids of every registered entity, in insertion order. */
  ids(): EntityId[] {
    return [...this.entries.keys()];
  }

  /** The number of registered entities. */
  get size(): number {
    return this.entries.size;
  }

  /**
   * The canonical name of `id`, or `undefined` if it is unregistered. The
   * canonical name is the label shown in Fact Lines and the People and Map
   * views.
   */
  canonicalName(id: EntityId): string | undefined {
    return this.entries.get(id)?.canonicalName;
  }

  /**
   * Every alias of `id`, with the canonical name folded in as a distinctive
   * alias (first, and never duplicated). This is the complete set of surface
   * forms for the entity. Returns `[]` for an unregistered id.
   */
  aliasesOf(id: EntityId): Alias[] {
    const entry = this.entries.get(id);
    if (entry === undefined) {
      return [];
    }
    const out: Alias[] = [{ text: entry.canonicalName, distinctive: true }];
    const seen = new Set<string>([matchKey(entry.canonicalName)]);
    for (const alias of entry.aliases) {
      const key = matchKey(alias.text);
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      out.push(alias);
    }
    return out;
  }

  /**
   * The distinctive surface forms of `id` — the canonical name plus every alias
   * flagged distinctive. These are the strings the Leak Guard matches against;
   * generic aliases are omitted because they are common words that would match
   * ordinary prose. Returns `[]` for an unregistered id.
   */
  distinctiveAliasesOf(id: EntityId): string[] {
    return this.aliasesOf(id)
      .filter((alias) => alias.distinctive)
      .map((alias) => alias.text);
  }
}
