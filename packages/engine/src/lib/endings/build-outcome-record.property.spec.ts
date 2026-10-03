/**
 * Property 26: Outcome Record derivation (task 20.5).
 *
 * **Validates: Requirements 35.2, 35.3**
 *
 * The design states (Correctness Property 26): "For any reachable final state,
 * `buildOutcomeRecord` is deterministic, its output passes the Outcome Record
 * schema, and `survivingAssets` is exactly the set of recruited NPCs whose
 * status is active." The record is a *sound, deterministic* derivation of the
 * ended game — its metadata reproduces/audits the game and its state is what a
 * campaign layer carries forward (Req 35.2), and it validates against the
 * versioned schema and round-trips through JSON unchanged (Req 35.3).
 *
 * This spec sweeps generated worlds (varied seeds and Difficulty Presets) and
 * ended-state variations with fast-check, then for each asserts:
 *
 * 1. **Determinism.** `buildOutcomeRecord(final, truth)` called twice is
 *    deep-equal.
 * 2. **survivingAssets is exactly the recruited, active Asset set.** The record
 *    lists the NPC ids of exactly those relationships that are recruited *and*
 *    carry an Asset profile ({@link isAsset}), sorted — unrecruited and
 *    profile-less relationships are excluded — and each entry's `doubled` flag
 *    equals the Asset's `hostileControlled` ground truth.
 * 3. **Metadata matches the final state.** `seed`, `generatorVersion`, the
 *    Content Manifest and the Difficulty Preset id equal the final state's
 *    `meta`, and `endedAt` equals the end's time.
 * 4. **The outcome tag maps outcome+cause correctly.** `record.outcome` equals
 *    {@link outcomeTagOf} (success / failure-plot / failure-burned).
 * 5. **Schema and JSON round-trip.** The record passes
 *    {@link OutcomeRecordSchema} and `parseOutcomeRecord(JSON.parse(JSON.stringify(
 *    record)))` is deep-equal to the record (Req 35.3).
 *
 * The generated-world construction mirrors the sibling example spec
 * (`outcome-record.spec.ts`): the real core pack, `generate(seed, inputs)`, an
 * `endedWorld`-style helper and an empty {@link TruthStore}. The run count is
 * bounded for CI (world generation per case is the cost), matching the engine's
 * property-spec `numRuns` conventions.
 */

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  loadCityData,
  loadContent,
  loadDescriptorData,
  loadPublicTexts,
  type CityData,
  type ContentSet,
  type DescriptorData,
  type DifficultyPreset,
  type PublicText,
} from '@tradecraft/content';

import { ScenarioConfigSchema } from '../config/scenario-config.js';
import { generate, type GenerateInputs } from '../generate.js';
import { TruthStore, type PredicateEvaluatorLookup } from '../truth/truth.js';
import { asTruth, revealTruth, type NpcId } from '../model/core.js';
import type { WorldState } from '../model/state.js';
import { isAsset, type AssetProfile, type Relationship } from '../recruit/asset.js';
import { buildOutcomeRecord, outcomeTagOf } from './build-outcome-record.js';
import {
  OUTCOME_RECORD_SCHEMA_VERSION,
  OutcomeRecordSchema,
  parseOutcomeRecord,
} from './outcome-record.js';

// ---------------------------------------------------------------------------
// Bounded run count for CI (each case generates a world, so keep it modest).
// ---------------------------------------------------------------------------

const RUNS = 60;

// ---------------------------------------------------------------------------
// Core-pack fixtures (mirrors outcome-record.spec.ts)
// ---------------------------------------------------------------------------

const CORE_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  '..',
  'content',
  'packs',
  'core',
);

function loadCore(): {
  content: ContentSet;
  cityData: CityData;
  descriptors: DescriptorData;
  publicTexts: readonly PublicText[];
} {
  const content = loadContent([CORE_DIR], ['core']);
  if (!content.ok) {
    throw new Error('core pack failed to load');
  }
  const cityData = loadCityData(CORE_DIR);
  const descriptors = loadDescriptorData(CORE_DIR);
  const publicTexts = loadPublicTexts(CORE_DIR);
  if (!cityData.ok || !descriptors.ok || !publicTexts.ok) {
    throw new Error('core pack side files failed to load');
  }
  return {
    content: content.value,
    cityData: cityData.value,
    descriptors: descriptors.value,
    publicTexts: publicTexts.value,
  };
}

const { content, cityData, descriptors, publicTexts } = loadCore();

function preset(id: string): DifficultyPreset {
  for (const [key, value] of content.difficultyPresets) {
    if (key === id || key.endsWith(`/${id}`)) {
      return value;
    }
  }
  throw new Error(`no difficulty preset ${id}`);
}

/** The shipped presets to sweep over (Req 35.2 records the preset id). */
const PRESET_IDS = ['easy', 'standard', 'hard'] as const;

function inputs(p: DifficultyPreset): GenerateInputs {
  const scenario = ScenarioConfigSchema.parse({
    difficulty: { preset: p.id },
    mole: false,
    recruitment: {
      pitch: { w1: 1, w2: 1, w3: 1, w4: 1 },
      firstContact: { a: 1, b: 1, c: 1, d: 1 },
      meeting: { trust: 1, riskAversion: 1, scheduleConflict: 1, agendaInterest: 1 },
      exposure: { k1: 1, k2: 1, k3: 1 },
      turn: { w1: 1, w2: 1, w3: 1, w4: 1, w5: 1 },
    },
  });
  return { content, preset: p, scenario, cityData, descriptors, publicTexts };
}

/** An empty Truth Store (the derivation reads revealed state fields, not it). */
function truth(): TruthStore {
  const lookup: PredicateEvaluatorLookup = { get: () => undefined };
  return TruthStore.create(lookup);
}

/** An active-Asset profile for a recruited relationship. */
function assetProfile(doubled: boolean): AssetProfile {
  return {
    access: asTruth({ locs: [], orgs: [], npcs: [] }),
    reliability: asTruth(0.7),
    turned: true,
    hostileControlled: asTruth(doubled),
  };
}

/** A recruited, active-Asset relationship with an NPC. */
function activeAsset(npc: NpcId, doubled: boolean): Relationship {
  return {
    npc,
    trust: 0.6,
    suspicion: 0.1,
    exposure: 0.2,
    recruited: true,
    contacts: 3,
    channel: true,
    coverState: 'intact',
    asset: assetProfile(doubled),
  };
}

/** A recruited-but-no-profile relationship: NOT an active Asset. */
function recruitedNoProfile(npc: NpcId): Relationship {
  return {
    npc,
    trust: 0.5,
    suspicion: 0.1,
    exposure: 0.2,
    recruited: true,
    contacts: 2,
    channel: true,
    coverState: 'intact',
    asset: undefined,
  };
}

/** An unrecruited relationship (even if it somehow carried a profile). */
function unrecruited(npc: NpcId, doubled: boolean): Relationship {
  return {
    npc,
    trust: 0.3,
    suspicion: 0.2,
    exposure: 0.1,
    recruited: false,
    contacts: 1,
    channel: false,
    coverState: 'intact',
    asset: assetProfile(doubled),
  };
}

/** The principal NPC ids of a generated world, in a stable order. */
function npcIds(state: WorldState): NpcId[] {
  return Object.keys(state.npcs) as NpcId[];
}

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

/** A short, deterministic seed string. */
const seedArb = fc.string({ minLength: 1, maxLength: 12 });

/** A Difficulty Preset id to generate under. */
const presetArb = fc.constantFrom(...PRESET_IDS);

/** The end's outcome + cause: a win, a plot-completed loss or a burned loss. */
const endArb = fc.constantFrom(
  { outcome: 'success' as const, cause: 'pressure' as const },
  { outcome: 'success' as const, cause: 'leader-arrested' as const },
  { outcome: 'success' as const, cause: 'materiel-seized' as const },
  { outcome: 'failure' as const, cause: 'plot-completed' as const },
  { outcome: 'failure' as const, cause: 'burned' as const },
);

/**
 * How to shape one of the world's NPCs' relationships. The kind decides whether
 * the NPC becomes an active Asset (and the oracle set we expect in the record).
 */
type RelKind = 'active' | 'active-doubled' | 'recruited-no-profile' | 'unrecruited' | 'none';

const relKindArb: fc.Arbitrary<RelKind> = fc.constantFrom(
  'active',
  'active-doubled',
  'recruited-no-profile',
  'unrecruited',
  'none',
);

/**
 * A per-NPC assignment: for the first few NPCs of the world, a chosen relation
 * kind. Up to five NPCs are touched so a case covers a varied set of
 * recruited/active/doubled relationships without depending on the world's size.
 */
const assignmentsArb = fc.array(relKindArb, { minLength: 0, maxLength: 5 });

// ---------------------------------------------------------------------------
// Build an ended world + the oracle expectation for its surviving Assets.
// ---------------------------------------------------------------------------

interface Expectation {
  readonly state: WorldState;
  /** The NPC ids expected in survivingAssets, sorted (the isAsset oracle). */
  readonly survivingIds: NpcId[];
  /** The doubled flag expected per surviving NPC id. */
  readonly doubledById: ReadonlyMap<NpcId, boolean>;
}

function buildEndedWorld(
  seed: string,
  presetId: (typeof PRESET_IDS)[number],
  end: { outcome: 'success' | 'failure'; cause: NonNullable<WorldState['ended']>['cause'] },
  kinds: readonly RelKind[],
): Expectation {
  const base = generate(seed, inputs(preset(presetId)));
  const ids = npcIds(base);

  const relationships: Record<string, Relationship> = {};
  const expectedDoubled = new Map<NpcId, boolean>();

  for (let i = 0; i < kinds.length && i < ids.length; i += 1) {
    const npc = ids[i];
    const kind = kinds[i];
    switch (kind) {
      case 'active':
        relationships[npc] = activeAsset(npc, false);
        expectedDoubled.set(npc, false);
        break;
      case 'active-doubled':
        relationships[npc] = activeAsset(npc, true);
        expectedDoubled.set(npc, true);
        break;
      case 'recruited-no-profile':
        relationships[npc] = recruitedNoProfile(npc);
        break;
      case 'unrecruited':
        relationships[npc] = unrecruited(npc, i % 2 === 0);
        break;
      case 'none':
        // Leave this NPC without an explicit relationship override.
        break;
    }
  }

  const state: WorldState = {
    ...base,
    relationships: { ...base.relationships, ...relationships },
    station: { ...base.station, standing: 4 },
    ended: { outcome: end.outcome, at: { day: 9, phase: 2 }, cause: end.cause },
  };

  // Oracle: survivingAssets is exactly the recruited-and-active Asset set, from
  // the FINAL state's relationships, sorted by NPC id — computed independently
  // from the derivation using the same isAsset predicate the spec validates.
  const survivingIds = (Object.values(state.relationships) as (Relationship | undefined)[])
    .filter((rel): rel is Relationship => rel !== undefined && isAsset(rel))
    .map((rel) => rel.npc)
    .filter((npc) => state.npcs[npc] !== undefined)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

  // The doubled flag the oracle expects: the Asset's hostileControlled truth.
  const doubledById = new Map<NpcId, boolean>();
  for (const npc of survivingIds) {
    const rel = state.relationships[npc];
    const prof = rel?.asset;
    doubledById.set(npc, prof !== undefined && revealTruth(prof.hostileControlled) === true);
  }

  return { state, survivingIds, doubledById };
}

const caseArb = fc
  .tuple(seedArb, presetArb, endArb, assignmentsArb)
  .map(([seed, presetId, end, kinds]) => buildEndedWorld(seed, presetId, end, kinds));

// ---------------------------------------------------------------------------
// Property 26 (Req 35.2, 35.3)
// ---------------------------------------------------------------------------

describe('Property 26: Outcome Record derivation', () => {
  it('is deterministic: the same final state yields a deep-equal record', () => {
    fc.assert(
      fc.property(caseArb, ({ state }) => {
        const a = buildOutcomeRecord(state, truth());
        const b = buildOutcomeRecord(state, truth());
        expect(b).toEqual(a);
      }),
      { numRuns: RUNS },
    );
  });

  it('lists exactly the recruited, active Asset set (sorted), with the doubled flag', () => {
    fc.assert(
      fc.property(caseArb, ({ state, survivingIds, doubledById }) => {
        const record = buildOutcomeRecord(state, truth());
        const got = record.survivingAssets.map((a) => a.npc);
        // Exactly the oracle set, in NPC-id order.
        expect(got).toEqual(survivingIds);
        // Sorted and free of duplicates.
        expect([...got].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))).toEqual(got);
        expect(new Set(got).size).toBe(got.length);
        // The doubled flag matches hostileControlled ground truth per Asset.
        for (const asset of record.survivingAssets) {
          expect(asset.doubled).toBe(doubledById.get(asset.npc));
        }
      }),
      { numRuns: RUNS },
    );
  });

  it('carries metadata (seed, generatorVersion, Content Manifest, preset id) from the final state', () => {
    fc.assert(
      fc.property(caseArb, ({ state }) => {
        const record = buildOutcomeRecord(state, truth());
        expect(record.schema).toBe(OUTCOME_RECORD_SCHEMA_VERSION);
        expect(record.seed).toBe(state.meta.seed);
        expect(record.generatorVersion).toBe(state.meta.generatorVersion);
        expect(record.content).toEqual(state.meta.content);
        const presetAny = state.meta.preset as unknown as { readonly id: string };
        expect(record.difficulty).toBe(presetAny.id);
        expect(record.endedAt).toEqual(state.ended?.at);
      }),
      { numRuns: RUNS },
    );
  });

  it('maps the outcome tag from outcome+cause (success / failure-plot / failure-burned)', () => {
    fc.assert(
      fc.property(caseArb, ({ state }) => {
        const record = buildOutcomeRecord(state, truth());
        expect(record.outcome).toBe(outcomeTagOf(state));
      }),
      { numRuns: RUNS },
    );
  });

  it('always validates against the schema and round-trips through JSON unchanged', () => {
    fc.assert(
      fc.property(caseArb, ({ state }) => {
        const record = buildOutcomeRecord(state, truth());
        // Validates against the versioned schema (Req 35.3).
        expect(OutcomeRecordSchema.safeParse(record).success).toBe(true);
        // Round-trips through JSON unchanged (Req 35.3).
        const roundTripped = parseOutcomeRecord(JSON.parse(JSON.stringify(record)));
        expect(roundTripped).toEqual(record);
      }),
      { numRuns: RUNS },
    );
  });
});
