/**
 * Property 24: Content load order independence.
 *
 * "For any valid pack set, loading the packs from any permutation of input
 * directories yields an identical Content Set and Content Manifest."
 * (design, Correctness Properties; Requirements 31.3 and 31.5.)
 *
 * The loader fixes the load order itself: packs are ordered topologically with
 * ties broken by pack id (Req 31.3), and the merge and per-pack hash are
 * deterministic (Req 31.5). So neither the order the `dirs` are listed in nor
 * the order the `selected` ids are given in may change the result. This is the
 * property-based companion to the single example-based ordering test in
 * `loader.spec.ts` ("produces the same ContentSet regardless of selection
 * order"): here we generate many pack sets — several packs, some depending on
 * others — and check every permutation of both inputs against a baseline load.
 */

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import fc from 'fast-check';
import { afterEach, describe, expect, it } from 'vitest';
import { stringify as toYaml } from 'yaml';

import { loadContent, type ContentSet } from '../index.js';

// --- fixtures --------------------------------------------------------------

const tempRoots: string[] = [];

afterEach(() => {
  while (tempRoots.length > 0) {
    const root = tempRoots.pop();
    if (root !== undefined) {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

/** One generated pack: an id, the ids it requires, and a payload nonce. */
interface GenPack {
  readonly id: string;
  readonly requires: readonly string[];
  /** A nonce woven into the pack's content so distinct packs hash distinctly. */
  readonly nonce: number;
}

/** The reusable predicate every pack carries, so each has real content. */
const predicateMeetsAt = {
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

const personaAustrian = {
  id: 'austrian',
  namePools: [
    { culture: 'austrian', gender: 'male', given: ['Franz'], family: ['Huber'] },
    { culture: 'austrian', gender: 'female', given: ['Maria'], family: ['Huber'] },
  ],
  backgrounds: ['A lifelong Viennese.'],
};

/** A minimal Descriptor library defining the one pool every pack's archetype names. */
const descriptorsCore = {
  version: 1,
  shared: { build: ['lean and stooped'], grooming: ['clean-shaven'] },
  pools: {
    'street-clothes': { garments: ['a loden coat'], accessories: ['a felt hat'] },
  },
};

/**
 * Lay out a set of generated packs on disk, one directory per pack. Only the
 * first pack (`core`) carries the shared predicate; every pack carries its own
 * namespaced archetype and persona so the merge has something from each pack,
 * and the per-pack `nonce` keeps distinct packs hashing distinctly.
 */
function writeGeneratedPacks(packs: readonly GenPack[]): string[] {
  const root = mkdtempSync(join(tmpdir(), 'tc-order-'));
  tempRoots.push(root);
  const dirs: string[] = [];

  for (const [index, pack] of packs.entries()) {
    const dir = join(root, pack.id);
    mkdirSync(dir, { recursive: true });

    const manifest: Record<string, unknown> = {
      id: pack.id,
      version: '1.0.0',
      contentSchema: 1,
    };
    if (pack.requires.length > 0) {
      manifest.requires = pack.requires.map((id) => ({ id, range: '^1.0.0' }));
    }
    writeFileSync(join(dir, 'pack.yaml'), toYaml(manifest), 'utf8');

    // The predicate vocabulary is defined once, in the first pack, so there is
    // no duplicate field code across packs.
    if (index === 0) {
      writeFileSync(
        join(dir, 'predicates.yaml'),
        toYaml([predicateMeetsAt]),
        'utf8',
      );
    }

    writeFileSync(join(dir, 'personas.yaml'), toYaml([personaAustrian]), 'utf8');
    writeFileSync(join(dir, 'descriptors.yaml'), toYaml(descriptorsCore), 'utf8');
    writeFileSync(
      join(dir, 'archetypes.yaml'),
      toYaml([
        {
          id: 'waiter',
          role: 'civilian',
          allowedAllegiances: ['neutral'],
          mice: {
            money: { min: 0, max: pack.nonce },
            ideology: { min: 0, max: 1 },
            coercion: { min: 0, max: 1 },
            ego: { min: 0, max: 1 },
          },
          wariness: { min: 0, max: 1 },
          // Reference this pack's own persona pool so cross-references resolve.
          personaPools: ['austrian'],
          descriptorPools: ['street-clothes'],
        },
      ]),
      'utf8',
    );

    dirs.push(dir);
  }

  return dirs;
}

// --- comparable projection -------------------------------------------------

/**
 * Project a {@link ContentSet} into a plain, order-independent value suitable
 * for deep equality. The registries are `Map`s, which `toEqual` compares by
 * iteration order; sorting their entries by key removes any dependence on the
 * order packs were merged, leaving only genuine content differences to show.
 * The manifest is already an array in load order and is compared as-is, so a
 * reordering of the packs would be caught.
 */
function comparable(set: ContentSet): unknown {
  const sortedEntries = (map: ReadonlyMap<string, unknown>): [string, unknown][] =>
    [...map.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));

  return {
    manifest: set.manifest,
    predicates: set.predicates.predicates
      .map((p) => ({ id: p.id, fieldCode: p.fieldCode, evaluator: p.evaluator }))
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
    archetypes: sortedEntries(set.archetypes),
    personaLibraries: sortedEntries(set.personaLibraries),
  };
}

function loadOk(dirs: readonly string[], selected: readonly string[]): ContentSet {
  const result = loadContent(dirs, selected);
  if (!result.ok) {
    throw new Error(
      `expected load to succeed, got errors:\n${JSON.stringify(result.errors, null, 2)}`,
    );
  }
  return result.value;
}

// --- generators ------------------------------------------------------------

/**
 * Generate a valid pack set: distinct ids and a strictly backward-pointing
 * `requires` edge set, so the dependency graph is always acyclic and every
 * requirement resolves. Pack `i` may require any earlier pack, which gives the
 * topological sort real ordering work to do while keeping the set loadable.
 */
const packSetArb: fc.Arbitrary<GenPack[]> = fc
  .integer({ min: 2, max: 6 })
  .chain((count) => {
    const ids = Array.from({ length: count }, (_, i) => `pack${i}`);
    const perPack = ids.map((id, i) =>
      fc
        .record({
          requires: fc.subarray(ids.slice(0, i), { minLength: 0 }),
          nonce: fc.integer({ min: 0, max: 1 }),
        })
        .map(({ requires, nonce }): GenPack => ({ id, requires, nonce })),
    );
    return fc.tuple(...perPack);
  });

/** A permutation of the given array, as an arbitrary. */
function permutationArb<T>(items: readonly T[]): fc.Arbitrary<T[]> {
  return fc.shuffledSubarray([...items], {
    minLength: items.length,
    maxLength: items.length,
  });
}

// --- the property ----------------------------------------------------------

describe('Property 24: content load order independence', () => {
  // 100 runs each write and load a set of packs on disk: ~2 s alone, several
  // times that when the workspace runs every suite in parallel.
  it('yields an identical Content Set and Manifest for any input permutation', () => {
    fc.assert(
      fc.property(
        packSetArb.chain((packs) => {
          const ids = packs.map((p) => p.id);
          return fc.record({
            packs: fc.constant(packs),
            dirOrder: permutationArb(ids),
            selectedOrder: permutationArb(ids),
          });
        }),
        ({ packs, dirOrder, selectedOrder }) => {
          const dirs = writeGeneratedPacks(packs);
          const dirOf = new Map(packs.map((p, i) => [p.id, dirs[i]]));

          // Baseline: dirs and selected in the generated (sorted) order.
          const baseline = loadOk(dirs, packs.map((p) => p.id));

          // Permuted: the same packs, dirs and selected ids shuffled.
          const permutedDirs = dirOrder.map((id) => dirOf.get(id) as string);
          const permuted = loadOk(permutedDirs, selectedOrder);

          expect(comparable(permuted)).toEqual(comparable(baseline));
          // The manifest's pack order is fixed by the loader, not the inputs.
          expect(permuted.manifest).toEqual(baseline.manifest);
        },
      ),
      { numRuns: 100 },
    );
  }, 60_000);
});
