import fc from 'fast-check';

import { EntityRegistry, type Alias, type EntityEntry, type EntityId } from '@tradecraft/engine';

import { checkLeak, type LeakContext } from './leak-guard.js';

/**
 * Property 6: Leak Guard soundness.
 *
 *   "For any sentence built from registry aliases, the guard rejects it if any
 *    distinctive alias belongs to an entity outside the known set, and accepts
 *    it otherwise."
 *   — design.md, Correctness Properties. **Validates: Requirement 5.2**
 *
 * The test generates a registry of entities (each with a canonical name,
 * distinctive aliases and generic aliases), an allowed ("known") set drawn from
 * those entities, and a sentence assembled from a chosen slice of those
 * aliases interleaved with neutral filler. It then asserts the single
 * biconditional the property names:
 *
 *   checkLeak rejects  ⟺  the sentence names, by a *distinctive* surface form,
 *                         at least one entity outside the allowed set.
 *
 * Two corollaries the property calls out explicitly are exercised by the same
 * assertion and reinforced by their own focused properties below:
 *
 *   - a *generic* alias never gates, even for an out-of-set entity;
 *   - a *distinctive* alias of an out-of-set entity always gates.
 *
 * ## Why the generators are coined, collision-free tokens
 *
 * The guard matches case-insensitively and whole-word. For the test's own
 * "expected" computation to be exact, the generated surface forms must not
 * collide with each other or with the filler: if two entities shared an alias,
 * or a filler word happened to be an alias, a sentence built for one entity
 * could trip on another and the oracle would disagree with the guard for
 * reasons that have nothing to do with soundness. So every surface form is a
 * distinct coined token (an invented capitalised word like `Qbxvor`) drawn from
 * a letters-only alphabet, every token in a world is unique, and the filler is
 * a small fixed set of ordinary lowercase words that are never used as aliases.
 * This keeps the input space squarely "sentences built from registry aliases"
 * while making the oracle a faithful, independent re-derivation of the rule.
 */

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

/** A coined, letters-only token used as a unique surface form, e.g. "Qbxvor". */
const tokenArb: fc.Arbitrary<string> = fc
  .stringMatching(/^[a-z]{4,9}$/)
  .map((s) => s[0].toUpperCase() + s.slice(1));

/** The six valid entity-id namespaces (see EntityId in @tradecraft/engine). */
const namespaceArb = fc.constantFrom('npc', 'loc', 'org', 'item', 'doc', 'chan');

/**
 * Neutral filler words that stitch the surface forms into a sentence. They are
 * ordinary lowercase words and are deliberately disjoint from the coined
 * capitalised alias alphabet, so no filler word can ever match an alias.
 */
const FILLER = [
  'the',
  'and',
  'met',
  'near',
  'about',
  'then',
  'with',
  'again',
  'later',
  'quietly',
] as const;

/**
 * One generated world: a registry, a set of allowed (known) entity ids, and a
 * record of each entity's distinctive and generic surface forms so the oracle
 * can reason about what *should* gate.
 */
interface World {
  readonly registry: EntityRegistry;
  readonly allowed: EntityId[];
  /** Per entity: its id and the surface forms, split by distinctiveness. */
  readonly entities: readonly {
    readonly id: EntityId;
    readonly distinctive: readonly string[];
    readonly generic: readonly string[];
  }[];
}

/**
 * Build a world from a pool of unique tokens. The pool is partitioned so that
 * every surface form across every entity is distinct: there is never an
 * accidental cross-entity collision for the oracle or the guard to trip on.
 *
 * Each entity gets a canonical name (always a distinctive surface form), zero
 * or more extra distinctive aliases, and zero or more generic aliases. Ids are
 * made unique by suffixing the entity's index.
 */
const worldArb: fc.Arbitrary<World> = fc
  .record({
    // A generous, de-duplicated pool of tokens to draw every surface form from.
    tokens: fc.uniqueArray(tokenArb, {
      minLength: 6,
      maxLength: 40,
      selector: (t) => t.toLowerCase(),
    }),
    // Per-entity shape: namespace, how many extra distinctive aliases, how many
    // generic aliases. Length drives the number of entities.
    shapes: fc.array(
      fc.record({
        namespace: namespaceArb,
        extraDistinctive: fc.nat({ max: 2 }),
        generic: fc.nat({ max: 2 }),
      }),
      { minLength: 1, maxLength: 6 },
    ),
    allowedMask: fc.array(fc.boolean(), { minLength: 1, maxLength: 6 }),
  })
  .map(({ tokens, shapes, allowedMask }) => {
    const entities: {
      id: EntityId;
      distinctive: string[];
      generic: string[];
      entry: EntityEntry;
    }[] = [];
    let cursor = 0;
    const take = (): string | undefined => tokens[cursor++];

    for (let i = 0; i < shapes.length; i += 1) {
      const shape = shapes[i];
      const canonical = take();
      if (canonical === undefined) break; // pool exhausted; stop adding entities

      const distinctive: string[] = [canonical];
      for (let d = 0; d < shape.extraDistinctive; d += 1) {
        const t = take();
        if (t !== undefined) distinctive.push(t);
      }
      const generic: string[] = [];
      for (let g = 0; g < shape.generic; g += 1) {
        const t = take();
        if (t !== undefined) generic.push(t);
      }

      const aliases: Alias[] = [
        ...distinctive.slice(1).map((text) => ({ text, distinctive: true })),
        ...generic.map((text) => ({ text, distinctive: false })),
      ];
      const id = `${shape.namespace}:e${i}` as EntityId;
      entities.push({
        id,
        distinctive,
        generic,
        entry: { id, canonicalName: canonical, aliases },
      });
    }

    const registry = EntityRegistry.from(entities.map((e) => e.entry));
    const allowed = entities
      .filter((_, i) => allowedMask[i % allowedMask.length])
      .map((e) => e.id);

    return {
      registry,
      allowed,
      entities: entities.map(({ id, distinctive, generic }) => ({
        id,
        distinctive,
        generic,
      })),
    };
  })
  // Keep only worlds with at least one entity (the pool could be exhausted
  // immediately only if minLength constraints failed, which they do not).
  .filter((w) => w.entities.length > 0);

/**
 * A reference to a single surface form chosen for the sentence: which entity it
 * names and whether that form is distinctive.
 */
interface Mention {
  readonly entity: EntityId;
  readonly alias: string;
  readonly distinctive: boolean;
}

/**
 * A world plus a sentence built from a chosen slice of its aliases. `mentions`
 * is the ground truth of exactly which surface forms the sentence contains, so
 * the oracle never has to re-parse the sentence.
 */
interface Scenario {
  readonly world: World;
  readonly sentence: string;
  readonly mentions: readonly Mention[];
}

/**
 * Choose a subset of (entity, alias) mentions and weave them into a sentence
 * with filler. Each entity contributes at most one surface form, matching the
 * guard's "one hit per entity" shape and keeping the oracle unambiguous.
 */
function scenarioArb(): fc.Arbitrary<Scenario> {
  return worldArb.chain((world) => {
    // For each entity, optionally pick one of its surface forms (distinctive or
    // generic). `undefined` means the entity is not mentioned at all.
    const perEntityChoice = world.entities.map((e) => {
      const forms: Mention[] = [
        ...e.distinctive.map((alias) => ({ entity: e.id, alias, distinctive: true })),
        ...e.generic.map((alias) => ({ entity: e.id, alias, distinctive: false })),
      ];
      return fc.option(fc.constantFrom(...forms), { nil: undefined, freq: 2 });
    });

    return fc
      .record({
        picks: fc.tuple(...perEntityChoice),
        leadFiller: fc.array(fc.constantFrom(...FILLER), { minLength: 0, maxLength: 3 }),
        gaps: fc.array(
          fc.array(fc.constantFrom(...FILLER), { minLength: 1, maxLength: 3 }),
          { minLength: 6, maxLength: 6 },
        ),
      })
      .map(({ picks, leadFiller, gaps }) => {
        const mentions = picks.filter((p): p is Mention => p !== undefined);
        const parts: string[] = [...leadFiller];
        mentions.forEach((m, i) => {
          parts.push(m.alias);
          parts.push(...gaps[i % gaps.length]);
        });
        const sentence = `${parts.join(' ')}.`;
        return { world, sentence, mentions };
      });
  });
}

/**
 * The oracle: the sentence should be rejected exactly when it names, by a
 * distinctive surface form, at least one entity outside the allowed set.
 */
function expectReject(scenario: Scenario): boolean {
  const allowed = new Set<EntityId>(scenario.world.allowed);
  return scenario.mentions.some((m) => m.distinctive && !allowed.has(m.entity));
}

function contextOf(world: World): LeakContext {
  return { registry: world.registry, allowed: world.allowed };
}

// ---------------------------------------------------------------------------
// Property 6
// ---------------------------------------------------------------------------

describe('Property 6: Leak Guard soundness (Req 5.2)', () => {
  it('rejects a sentence iff it names an out-of-set entity by a distinctive alias', () => {
    fc.assert(
      fc.property(scenarioArb(), (scenario) => {
        const result = checkLeak(scenario.sentence, contextOf(scenario.world));
        expect(result.ok).toBe(!expectReject(scenario));
      }),
      { numRuns: 300 },
    );
  });

  it('reports exactly the out-of-set, distinctively-named entities as hits', () => {
    fc.assert(
      fc.property(scenarioArb(), (scenario) => {
        const allowed = new Set<EntityId>(scenario.world.allowed);
        const expectedEntities = scenario.mentions
          .filter((m) => m.distinctive && !allowed.has(m.entity))
          .map((m) => m.entity)
          .sort();

        const result = checkLeak(scenario.sentence, contextOf(scenario.world));
        const hitEntities = result.hits.map((h) => h.entity).sort();

        expect(hitEntities).toEqual(expectedEntities);
      }),
      { numRuns: 300 },
    );
  });

  it('never gates on a generic alias, even for an out-of-set entity', () => {
    // Build sentences from generic aliases only. Whatever the allowed set, the
    // guard must accept, because generic aliases are common words that never
    // identify an entity on their own.
    const genericOnlyArb = worldArb
      .filter((w) => w.entities.some((e) => e.generic.length > 0))
      .chain((world) => {
        const generics = world.entities.flatMap((e) =>
          e.generic.map((alias) => ({ entity: e.id, alias })),
        );
        return fc
          .record({
            chosen: fc.subarray(generics, { minLength: 1 }),
            gap: fc.array(fc.constantFrom(...FILLER), { minLength: 1, maxLength: 3 }),
          })
          .map(({ chosen, gap }) => {
            const sentence = `${chosen.flatMap((c) => [c.alias, ...gap]).join(' ')}.`;
            return { world, sentence };
          });
      });

    fc.assert(
      fc.property(genericOnlyArb, ({ world, sentence }) => {
        expect(checkLeak(sentence, contextOf(world)).ok).toBe(true);
      }),
      { numRuns: 200 },
    );
  });

  it('always gates on a distinctive alias of an out-of-set entity', () => {
    // Pick one entity, force it out of the allowed set, and name it by one of
    // its distinctive forms. The guard must reject and must report that entity.
    const forcedLeakArb = worldArb.chain((world) =>
      fc
        .record({
          index: fc.nat({ max: world.entities.length - 1 }),
          lead: fc.array(fc.constantFrom(...FILLER), { minLength: 0, maxLength: 2 }),
          tail: fc.array(fc.constantFrom(...FILLER), { minLength: 0, maxLength: 2 }),
        })
        .chain(({ index, lead, tail }) => {
          const target = world.entities[index];
          return fc.constantFrom(...target.distinctive).map((alias) => {
            const sentence = `${[...lead, alias, ...tail].join(' ')}.`;
            // Allowed set is everyone *except* the target.
            const allowed = world.entities
              .filter((e) => e.id !== target.id)
              .map((e) => e.id);
            return { world: { ...world, allowed }, sentence, target: target.id };
          });
        }),
    );

    fc.assert(
      fc.property(forcedLeakArb, ({ world, sentence, target }) => {
        const result = checkLeak(sentence, contextOf(world));
        expect(result.ok).toBe(false);
        expect(result.hits.map((h) => h.entity)).toContain(target);
      }),
      { numRuns: 200 },
    );
  });
});
