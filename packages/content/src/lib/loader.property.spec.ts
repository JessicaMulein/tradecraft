/**
 * Property 23: Content validation.
 *
 * > For any generated valid pack set, loading succeeds and every
 * > cross-reference resolves. For any single corruption (a dangling reference,
 * > a duplicate id without override, an undeclared template slot, an unknown
 * > evaluator kind, or a duplicate field code), loading fails with an error
 * > whose pack, file and path locate the corruption.
 *
 * **Validates: Requirements 31.2, 31.4, 32.2, 32.4**
 *
 * The example-based corruptions live in `loader.spec.ts`; this file adds the
 * property. A smart generator builds a *valid* base pack — randomised predicate
 * ids, field codes, archetypes, persona pools and Location Types, all wired so
 * every cross-reference resolves — and asserts it loads cleanly. A second
 * generator picks one of the five corruption kinds, applies it to a fresh valid
 * pack, and asserts the load fails with at least one `ContentError` that locates
 * the corruption (right file, and a path pointing at the mutated field).
 *
 * Packs are materialised to a per-run temp directory with the same fixture
 * approach `loader.spec.ts` uses, and torn down afterwards.
 */

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import fc from 'fast-check';
import { afterEach, describe, expect, it } from 'vitest';
import { stringify as toYaml } from 'yaml';

import { loadContent, type ContentError } from '../index.js';

// --- temp-dir plumbing -----------------------------------------------------

const tempRoots: string[] = [];

afterEach(() => {
  while (tempRoots.length > 0) {
    const root = tempRoots.pop();
    if (root !== undefined) {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

/** Write a single pack's files to a fresh temp dir and return its directory. */
function writePack(files: Record<string, unknown>): string {
  const root = mkdtempSync(join(tmpdir(), 'tc-prop-'));
  tempRoots.push(root);
  const dir = join(root, 'core');
  mkdirSync(dir, { recursive: true });
  for (const [rel, value] of Object.entries(files)) {
    writeFileSync(
      join(dir, rel),
      typeof value === 'string' ? value : toYaml(value),
      'utf8',
    );
  }
  return dir;
}

// --- a valid pack, as a plain data structure we can mutate -----------------

/**
 * The parts of a core pack this property exercises. We keep them as a typed
 * object so each corruption can reach precisely into one field, then serialise
 * the whole thing to YAML files at the end.
 */
interface ValidPack {
  predicates: PredicateData[];
  archetypes: ArchetypeData[];
  personas: PersonaData[];
  locationTypes: LocationTypeData[];
}

interface PredicateData {
  id: string;
  subject: string[];
  object: { entity: string[] } | { literal: string };
  place: 'required' | 'optional' | 'none';
  window: 'required' | 'optional' | 'none';
  evaluator: string;
  fieldCode: string;
  render: { second: string; third: string };
  extractorHint: string;
}

interface ArchetypeData {
  id: string;
  role: string;
  allowedAllegiances: string[];
  mice: Record<'money' | 'ideology' | 'coercion' | 'ego', { min: number; max: number }>;
  wariness: { min: number; max: number };
  personaPools: string[];
  descriptorPools: string[];
}

interface PersonaData {
  id: string;
  namePools: {
    culture: string;
    gender: 'female' | 'male';
    given: string[];
    family: string[];
  }[];
  backgrounds: string[];
}

interface LocationTypeData {
  id: string;
  public: boolean;
  allowedActions: string[];
  baseRisk: number;
  allowsDeadDrops: boolean;
  namePatterns: string[];
  descriptionPool: string[];
  atmosphereTags: string[];
}

const EVALUATOR_KINDS = [
  'fact-match',
  'fact-match-symmetric',
  'alias',
  'membership-transitive',
] as const;

// --- generators ------------------------------------------------------------

/** An UPPER_SNAKE_CASE predicate id, with a numeric suffix to keep ids unique. */
function predicateIdArb(): fc.Arbitrary<string> {
  return fc
    .tuple(
      fc.constantFrom('MEETS', 'KNOWS', 'PAYS', 'ALIASES', 'MEMBER', 'OWNS'),
      fc.integer({ min: 0, max: 9999 }),
    )
    .map(([stem, n]) => `${stem}_${n}`);
}

/** A valid 1–4 char field code; the numeric part keeps codes distinct. */
function fieldCodeArb(): fc.Arbitrary<string> {
  return fc.integer({ min: 0, max: 999 }).map((n) => `F${n}`);
}

/** A single valid predicate with a `required` place and window so it has every slot. */
function predicateArb(): fc.Arbitrary<PredicateData> {
  return fc
    .record({
      id: predicateIdArb(),
      evaluator: fc.constantFrom(...EVALUATOR_KINDS),
      fieldCode: fieldCodeArb(),
    })
    .map(({ id, evaluator, fieldCode }) => ({
      id,
      subject: ['npc', 'unk'],
      object: { entity: ['npc', 'unk'] },
      place: 'required' as const,
      window: 'required' as const,
      evaluator,
      fieldCode,
      render: {
        second: 'You meet {object} at {place} {when}.',
        third: '{subject} meets {object} at {place} {when}.',
      },
      extractorHint: 'Two people meet at a place.',
    }));
}

/** A hyphenated content id with a numeric suffix for uniqueness. */
function contentIdArb(stem: string): fc.Arbitrary<string> {
  return fc.integer({ min: 0, max: 9999 }).map((n) => `${stem}-${n}`);
}

function personaArb(): fc.Arbitrary<PersonaData> {
  return contentIdArb('persona').map((id) => ({
    id,
    namePools: [
      { culture: 'austrian', gender: 'male' as const, given: ['Franz'], family: ['Huber'] },
      {
        culture: 'austrian',
        gender: 'female' as const,
        given: ['Maria'],
        family: ['Gruber'],
      },
    ],
    backgrounds: ['A lifelong Viennese.'],
  }));
}

function locationTypeArb(): fc.Arbitrary<LocationTypeData> {
  return fc
    .record({ id: contentIdArb('loc'), baseRisk: fc.float({ min: 0, max: 1, noNaN: true }) })
    .map(({ id, baseRisk }) => ({
      id,
      public: true,
      allowedActions: ['talk', 'surveil'],
      baseRisk,
      allowsDeadDrops: false,
      namePatterns: ['Café {pick:names}'],
      descriptionPool: ['A warm coffee house.'],
      atmosphereTags: ['smoky'],
    }));
}

/**
 * A whole valid pack: at least one of each kind, with every archetype's
 * persona pool pointing at a persona that is actually present (as a bare id,
 * which the loader namespaces to this pack). Predicate ids and field codes are
 * de-duplicated so the base pack is always valid before any corruption.
 */
function validPackArb(): fc.Arbitrary<ValidPack> {
  return fc
    .record({
      predicates: fc.array(predicateArb(), { minLength: 1, maxLength: 4 }),
      personas: fc.array(personaArb(), { minLength: 1, maxLength: 3 }),
      locationTypes: fc.array(locationTypeArb(), { minLength: 1, maxLength: 3 }),
      archetypeCount: fc.integer({ min: 1, max: 3 }),
    })
    .map(({ predicates, personas, locationTypes, archetypeCount }) => {
      const uniquePredicates = dedupePredicates(predicates);
      const uniquePersonas = dedupeById(personas);
      const uniqueLocations = dedupeById(locationTypes);
      const poolIds = uniquePersonas.map((p) => p.id);

      const archetypes: ArchetypeData[] = Array.from(
        { length: archetypeCount },
        (_, i) => ({
          id: `archetype-${i}`,
          role: 'civilian',
          allowedAllegiances: ['neutral'],
          mice: {
            money: { min: 0, max: 1 },
            ideology: { min: 0, max: 1 },
            coercion: { min: 0, max: 1 },
            ego: { min: 0, max: 1 },
          },
          wariness: { min: 0, max: 1 },
          // Reference an existing persona by its bare id (loader namespaces it).
          personaPools: [poolIds[i % poolIds.length]],
          descriptorPools: ['street-clothes'],
        }),
      );

      return {
        predicates: uniquePredicates,
        archetypes,
        personas: uniquePersonas,
        locationTypes: uniqueLocations,
      };
    });
}

/** Drop later predicates that collide on id or field code with an earlier one. */
function dedupePredicates(items: readonly PredicateData[]): PredicateData[] {
  const seenIds = new Set<string>();
  const seenCodes = new Set<string>();
  const out: PredicateData[] = [];
  for (const item of items) {
    if (seenIds.has(item.id) || seenCodes.has(item.fieldCode)) {
      continue;
    }
    seenIds.add(item.id);
    seenCodes.add(item.fieldCode);
    out.push(item);
  }
  return out;
}

/** Drop later items that collide on id with an earlier one. */
function dedupeById<T extends { id: string }>(items: readonly T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    if (seen.has(item.id)) {
      continue;
    }
    seen.add(item.id);
    out.push(item);
  }
  return out;
}

/** Serialise a valid pack to the file map the fixture writer expects. */
function packToFiles(pack: ValidPack): Record<string, unknown> {
  return {
    'pack.yaml': { id: 'core', version: '1.0.0', contentSchema: 1 },
    'predicates.yaml': pack.predicates,
    'archetypes.yaml': pack.archetypes,
    'personas.yaml': pack.personas,
    'descriptors.yaml': {
      version: 1,
      shared: { build: ['lean and stooped'], grooming: ['clean-shaven'] },
      pools: { 'street-clothes': { garments: ['a loden coat'] } },
    },
    'location-types.yaml': pack.locationTypes,
  };
}

// --- corruptions -----------------------------------------------------------

/**
 * A single corruption: it mutates a valid pack in place and names the file and
 * a path-predicate the located error must satisfy. `expectPath` lets a
 * corruption accept any of several precise paths (e.g. the dangling-ref path
 * depends on which archetype was mutated).
 */
interface Corruption {
  readonly label: string;
  readonly apply: (pack: ValidPack) => void;
  readonly file: string;
  readonly pathMatches: (path: string) => boolean;
}

const corruptionArb: fc.Arbitrary<Corruption> = fc.oneof(
  // Dangling cross-reference: point an archetype's persona pool at nothing.
  fc.constant<Corruption>({
    label: 'dangling-reference',
    apply: (pack) => {
      pack.archetypes[0].personaPools = ['nope-does-not-exist'];
    },
    file: 'cross-reference',
    pathMatches: (p) => /^core\/archetype-0\.personaPools\[0\]$/.test(p),
  }),

  // Duplicate id without override: repeat the first archetype.
  fc.constant<Corruption>({
    label: 'duplicate-id',
    apply: (pack) => {
      pack.archetypes.push({ ...pack.archetypes[0] });
    },
    file: 'archetypes.yaml',
    pathMatches: (p) => /\.id$/.test(p) || /^\[\d+\]\.id$/.test(p),
  }),

  // Undeclared template slot in a predicate renderer.
  fc.constant<Corruption>({
    label: 'undeclared-template-slot',
    apply: (pack) => {
      pack.predicates[0].render = {
        second: 'You meet {object}.',
        third: '{subject} meets {ghost}.',
      };
    },
    file: 'predicates.yaml',
    pathMatches: (p) => /^\[0\]\.render\.third$/.test(p),
  }),

  // Unknown evaluator kind — the closed evaluator set (Req 32.4).
  fc.constant<Corruption>({
    label: 'unknown-evaluator-kind',
    apply: (pack) => {
      pack.predicates[0].evaluator = 'telepathy';
    },
    file: 'predicates.yaml',
    pathMatches: (p) => /^\[0\]\.evaluator$/.test(p),
  }),

  // Duplicate field code across two predicates (Req 32.2).
  fc.constant<Corruption>({
    label: 'duplicate-field-code',
    apply: (pack) => {
      const clash: PredicateData = {
        ...pack.predicates[0],
        id: `${pack.predicates[0].id}_CLONE`,
      };
      pack.predicates.push(clash);
    },
    file: 'predicates.yaml',
    pathMatches: (p) => /^\[\d+\]\.fieldCode$/.test(p),
  }),
);

// --- the property ----------------------------------------------------------

describe('Property 23: Content validation', () => {
  it('loads any generated valid pack and resolves every cross-reference', () => {
    fc.assert(
      fc.property(validPackArb(), (pack) => {
        const dir = writePack(packToFiles(pack));
        const result = loadContent([dir], ['core']);
        if (!result.ok) {
          throw new Error(
            `expected a valid pack to load, got:\n${JSON.stringify(result.errors, null, 2)}`,
          );
        }
        // Every declared archetype, persona, Location Type and predicate is present.
        expect(result.value.archetypes.size).toBe(pack.archetypes.length);
        expect(result.value.personaLibraries.size).toBe(pack.personas.length);
        expect(result.value.locationTypes.size).toBe(pack.locationTypes.length);
        for (const pred of pack.predicates) {
          expect(result.value.predicates.has(pred.id)).toBe(true);
        }
      }),
      { numRuns: 100 },
    );
  });

  it('rejects a single corruption with a located ContentError', () => {
    fc.assert(
      fc.property(validPackArb(), corruptionArb, (pack, corruption) => {
        corruption.apply(pack);
        const dir = writePack(packToFiles(pack));
        const result = loadContent([dir], ['core']);

        if (result.ok) {
          throw new Error(
            `expected corruption "${corruption.label}" to fail the load, but it succeeded`,
          );
        }

        // Some error must locate the corruption: right pack, right file, and a
        // path that points at the mutated field.
        const located = result.errors.find(
          (e: ContentError) =>
            e.pack === 'core' &&
            e.file === corruption.file &&
            corruption.pathMatches(e.path),
        );
        if (located === undefined) {
          throw new Error(
            `corruption "${corruption.label}" produced no located error.\n` +
              `errors:\n${JSON.stringify(result.errors, null, 2)}`,
          );
        }
      }),
      { numRuns: 100 },
    );
  });
});
