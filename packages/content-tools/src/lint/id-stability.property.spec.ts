/**
 * Property 7: Id stability against a baseline (content-expansion task 5.8;
 * design, "Correctness Properties"; Pack Linter).
 *
 * **Feature: content-expansion, Property 7.**
 *
 * **Validates: Requirements 13.7, 17.5.**
 *
 * > For any Baseline Manifest and current pack version, the CE-IDSTABLE findings
 * > are exactly the ids in the baseline that are missing from the current version
 * > when the major version is unchanged, and are empty when the major version
 * > increased. (design, Property 7)
 *
 * CE-IDSTABLE is what keeps the campaign-career references stable: a career path
 * that names City/Cover/Service ids must keep finding them across minor and patch
 * releases, and only a deliberate major bump is allowed to drop them (Req 13.7,
 * 17.5). The rule reads the loaded Content Set's registries for the current ids
 * and the supplied {@link BaselineManifest} for the ids each pack held and the
 * version it was taken at.
 *
 * This property drives the real {@link idStableCheck} over arbitrary per-pack
 * baseline id sets, current id sets and version pairs (same major, or an increased
 * major), with the current ids planted in a minimal Content Set exactly as the
 * example tests do ({@link ./period-rules.spec.ts}, the `setWith`/`baseline`
 * helpers). An independent oracle recomputes the expected finding set straight
 * from the invariant — the removed-id set per pack when the major is unchanged,
 * and nothing when the major increased — so a passing run pins the rule against
 * that invariant rather than against itself.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { idStableCheck } from './stability-rules.js';
import type { BaselineManifest, LintContext } from './rules.js';

// ---------------------------------------------------------------------------
// Minimal Content Set carrying the current ids (mirrors period-rules.spec.ts)
// ---------------------------------------------------------------------------

/** One pack's current state: its manifest version and its namespaced service ids. */
interface CurrentPack {
  readonly id: string;
  readonly version: string;
  /** Bare content ids the pack currently holds (namespaced as `<pack>/<id>`). */
  readonly ids: readonly string[];
}

/**
 * A minimal Content Set carrying only a manifest and the services registry, with
 * every current id planted under its pack's namespace (`<pack>/<id>`). This is the
 * single registry the example tests use to stand in for the pack's current ids,
 * and {@link currentIdsByPack} splits the namespace back off before comparing.
 */
function setWith(packs: readonly CurrentPack[]): LintContext['set'] {
  const services = new Map<string, unknown>();
  for (const pack of packs) {
    for (const id of pack.ids) {
      services.set(`${pack.id}/${id}`, {});
    }
  }
  return {
    predicates: {} as never,
    archetypes: new Map(),
    locationTypes: new Map(),
    plotTemplates: new Map(),
    sideThreadTemplates: new Map(),
    documentTemplates: new Map(),
    personaLibraries: new Map(),
    coverIdentities: new Map(),
    rumourTemplates: new Map(),
    hints: new Map(),
    glossary: new Map(),
    difficultyPresets: new Map(),
    services,
    templateVariantDefs: new Map(),
    templateVariants: {} as never,
    cities: {},
    cultureGroups: {},
    descriptorFragments: [],
    tagVocabulary: { facets: [], tags: [], requiredQueries: [] },
    cityScopeOwner: {},
    registry: [],
    manifest: {
      schema: 2,
      packs: packs.map((p) => ({ id: p.id, version: p.version, hash: 'h' })),
    },
  } as unknown as LintContext['set'];
}

/** One pack's baseline state: its baseline version and the ids it then held. */
interface BaselinePack {
  readonly id: string;
  readonly version: string;
  readonly ids: readonly string[];
}

/** A Baseline Manifest over several packs. */
function baseline(packs: readonly BaselinePack[]): BaselineManifest {
  return {
    manifest: {
      schema: 2,
      packs: packs.map((p) => ({ id: p.id, version: p.version, hash: 'h0' })),
    },
    ids: Object.fromEntries(packs.map((p) => [p.id, p.ids])),
  } as unknown as BaselineManifest;
}

// ---------------------------------------------------------------------------
// Arbitraries spanning the quantified input space
// ---------------------------------------------------------------------------

/** The bare content ids drawn from, so baseline and current sets can overlap or not. */
const ID_POOL = ['svc-a', 'svc-b', 'svc-c', 'svc-d', 'svc-e'] as const;

/** A distinct, non-empty subset of the id pool, in pool order. */
const idSetArb: fc.Arbitrary<string[]> = fc
  .subarray([...ID_POOL], { minLength: 0 })
  .map((ids) => [...ids]);

/** A well-formed `major.minor.patch` version with small components. */
const versionArb: fc.Arbitrary<{ text: string; major: number }> = fc
  .record({
    major: fc.integer({ min: 0, max: 5 }),
    minor: fc.integer({ min: 0, max: 9 }),
    patch: fc.integer({ min: 0, max: 9 }),
  })
  .map(({ major, minor, patch }) => ({ text: `${major}.${minor}.${patch}`, major }));

/**
 * The full per-pack sample: a baseline (version + ids) and a current (version +
 * ids). The current major is drawn to be either equal to the baseline's (the
 * stability-enforced case) or strictly greater (the major-bump escape hatch), so
 * both branches of the property are exercised across the generated space.
 */
interface PackSample {
  readonly id: string;
  readonly baselineVersion: string;
  readonly baselineIds: string[];
  readonly currentVersion: string;
  readonly currentIds: string[];
  readonly majorIncreased: boolean;
}

/** A sample for a single pack with the given id. */
function packSampleArb(id: string): fc.Arbitrary<PackSample> {
  return fc
    .record({
      baseline: versionArb,
      baselineIds: idSetArb,
      currentIds: idSetArb,
      majorBump: fc.boolean(),
      majorDelta: fc.integer({ min: 1, max: 3 }),
      minor: fc.integer({ min: 0, max: 9 }),
      patch: fc.integer({ min: 0, max: 9 }),
    })
    .map(({ baseline: base, baselineIds, currentIds, majorBump, majorDelta, minor, patch }) => {
      const currentMajor = majorBump ? base.major + majorDelta : base.major;
      return {
        id,
        baselineVersion: base.text,
        baselineIds,
        currentVersion: `${currentMajor}.${minor}.${patch}`,
        currentIds,
        majorIncreased: currentMajor > base.major,
      };
    });
}

/**
 * A whole sample: one PackSample per pack id. Several packs let the property pin
 * that per-pack majors and id sets are handled independently.
 */
const PACK_IDS = ['era', 'city', 'library'] as const;

const sampleArb: fc.Arbitrary<PackSample[]> = fc.tuple(
  ...PACK_IDS.map((id) => packSampleArb(id)),
) as fc.Arbitrary<PackSample[]>;

// ---------------------------------------------------------------------------
// Independent oracle for the property
// ---------------------------------------------------------------------------

/**
 * The ids the rule must report for one pack, computed straight from the invariant:
 * when the current major is strictly greater than the baseline major every removal
 * is allowed (no findings), otherwise every baseline id absent from the current id
 * set is a finding. Order follows the baseline id list, as the rule iterates it.
 */
function expectedRemovedIds(sample: PackSample): string[] {
  if (sample.majorIncreased) {
    return [];
  }
  const current = new Set(sample.currentIds);
  return sample.baselineIds.filter((id) => !current.has(id));
}

/** The `pack/id` key the oracle compares findings against, independent of message text. */
function findingKey(packId: string, id: string): string {
  return `${packId}/${id}`;
}

// ---------------------------------------------------------------------------
// Property 7
// ---------------------------------------------------------------------------

describe('Property 7: id stability against a baseline (Req 13.7, 17.5)', () => {
  it('reports exactly the removed baseline ids per pack, and nothing when the major increased', () => {
    fc.assert(
      fc.property(sampleArb, (samples) => {
        const ctx: LintContext = {
          set: setWith(
            samples.map((s) => ({ id: s.id, version: s.currentVersion, ids: s.currentIds })),
          ),
          loadErrors: [],
          registry: [],
          profile: 'draft',
          packs: [],
          baseline: baseline(
            samples.map((s) => ({ id: s.id, version: s.baselineVersion, ids: s.baselineIds })),
          ),
        };

        const findings = idStableCheck(ctx);

        // Every finding is a CE-IDSTABLE error located at a pack and an `ids/<id>` path.
        for (const f of findings) {
          expect(f.rule).toBe('CE-IDSTABLE');
          expect(f.severity).toBe('error');
          expect(f.path.startsWith('ids/')).toBe(true);
        }

        // The reported (pack, id) set equals the oracle's removed-id set exactly.
        const reported = findings
          .map((f) => findingKey(f.pack, f.path.slice('ids/'.length)))
          .sort();
        const expected = samples
          .flatMap((s) => expectedRemovedIds(s).map((id) => findingKey(s.id, id)))
          .sort();
        expect(reported).toEqual(expected);

        // No duplicate findings: at most one per (pack, id).
        expect(new Set(reported).size).toBe(reported.length);
      }),
    );
  });

  it('is empty whenever every pack had its major version increased', () => {
    fc.assert(
      fc.property(
        // Force the major bump so the escape hatch is always the active branch.
        fc.tuple(
          ...PACK_IDS.map((id) =>
            fc
              .record({
                baseline: versionArb,
                baselineIds: idSetArb,
                currentIds: idSetArb,
                majorDelta: fc.integer({ min: 1, max: 3 }),
                minor: fc.integer({ min: 0, max: 9 }),
                patch: fc.integer({ min: 0, max: 9 }),
              })
              .map(({ baseline: base, baselineIds, currentIds, majorDelta, minor, patch }): PackSample => {
                const currentMajor = base.major + majorDelta;
                return {
                  id,
                  baselineVersion: base.text,
                  baselineIds,
                  currentVersion: `${currentMajor}.${minor}.${patch}`,
                  currentIds,
                  majorIncreased: true,
                };
              }),
          ),
        ) as fc.Arbitrary<PackSample[]>,
        (samples) => {
          const ctx: LintContext = {
            set: setWith(
              samples.map((s) => ({ id: s.id, version: s.currentVersion, ids: s.currentIds })),
            ),
            loadErrors: [],
            registry: [],
            profile: 'draft',
            packs: [],
            baseline: baseline(
              samples.map((s) => ({ id: s.id, version: s.baselineVersion, ids: s.baselineIds })),
            ),
          };
          expect(idStableCheck(ctx)).toEqual([]);
        },
      ),
    );
  });
});
