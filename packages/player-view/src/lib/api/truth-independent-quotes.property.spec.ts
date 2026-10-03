/**
 * Feature: slice-integration, Property 47: Player-side quotes are
 * truth-independent.
 *
 * **Validates: Requirements 10.2, 14.3**
 *
 * The design states (slice-integration design, "Property 47: Player-side quotes
 * are truth-independent"): for any reachable state, Case File and `task` or
 * `feed` action, applying any modification to the Truth Store (and to
 * `Truth`-branded fields not visible to the player) leaves the quote's
 * `allowed`, `reason`, `phases` and `money` unchanged, and leaves `validateFeed`'s
 * result unchanged.
 *
 * Two player-side decisions are driven here:
 *
 *  - the `task` action quote, decided only from the Asset's {@link Relationship}
 *    flags (recruited, an Asset profile, a Contact Channel; Req 10.2), never from
 *    the Truth Store or a `Truth`-branded profile field (access, reliability,
 *    `hostileControlled`); and
 *  - the facade's `validateFeed`, which runs the engine's shared
 *    `validateFeedItems` over the truth-free {@link feedView} the facade builds
 *    from the clock, the player's known set and the held Case File Claims (Req
 *    14.3).
 *
 * ## Shape of the check (mirrors Property 49)
 *
 * An arbitrary draws a set of player-side records over a generated world — a
 * random subset of Relationships flipped into running Assets (recruited, with a
 * minted profile, with or without a Contact Channel) and a random known set —
 * and overlays them both on a base world and on a *truth-mutated twin* of that
 * base world (identical in exactly those records, but with ground truth rewritten:
 * every NPC's `trueAllegiance`, the plot and hostile truth slices swapped in from
 * a world off a DIFFERENT seed, every Asset's `Truth`-branded profile fields
 * flipped, and the player's truth-branded cover fields flipped). It also draws a
 * battery of `task` actions (over Assets with and without a Channel, over plain
 * NPCs, over absent ids) and `feed` item lists (held Claims, composed items over
 * known and unknown entities, `unk:` ids that an optional held `IS_ALIAS_OF`
 * Claim resolves, and counts that straddle 1–3).
 *
 * The quote and `validateFeed` are evaluated on both overlaid states and asserted
 * to agree: changing ground truth without changing the player-side records and
 * the Case File cannot change either answer. A `feed` result compares the `ok`
 * flag and, on failure, the exact {@link FeedError} list.
 *
 * The two decisions are reached through exactly the surfaces the facade uses:
 * `quoteTask` is what the engine `quote` dispatches to for a `task` action, and
 * `feedView` + `validateFeedItems` is what `EngineApi.validateFeed` calls. The
 * core-pack fixture pattern mirrors `objective-evaluator.property.spec.ts`.
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
import {
  asTruth,
  assetProfileFor,
  generateGame,
  newRelationship,
  quoteTask,
  revealTruth,
  validateFeedItems,
  ScenarioConfigSchema,
  TASK_MONEY_COST,
  TASK_PHASE_COST,
  type ComposedProposition,
  type EntityId,
  type FeedItem,
  type GameTime,
  type GenerateInputs,
  type LocId,
  type NpcId,
  type Proposition,
  type Relationship,
  type TaskAction,
  type UnkId,
  type WorldState,
} from '@tradecraft/engine';

import { CaseFile, type ClaimSource } from '../casefile/casefile.js';
import { feedView } from './feed-view.js';

// ---------------------------------------------------------------------------
// Core-pack fixtures (mirrors objective-evaluator.property.spec.ts)
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
  if (!content.ok) throw new Error('core pack failed to load');
  const cityData = loadCityData(CORE_DIR);
  if (!cityData.ok) throw new Error('city.yaml failed to load');
  const descriptors = loadDescriptorData(CORE_DIR);
  if (!descriptors.ok) throw new Error('descriptors.yaml failed to load');
  const publicTexts = loadPublicTexts(CORE_DIR);
  if (!publicTexts.ok) throw new Error('public texts failed to load');
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
    if (key === id || key.endsWith(`/${id}`)) return value;
  }
  throw new Error(`no difficulty preset ${id}`);
}

const STANDARD = preset('standard');

function inputs(): GenerateInputs {
  const scenario = ScenarioConfigSchema.parse({
    difficulty: { preset: 'standard' },
    mole: true,
    recruitment: {
      pitch: { w1: 1, w2: 1, w3: 1, w4: 1 },
      firstContact: { a: 1, b: 1, c: 1, d: 1 },
      meeting: { trust: 1, riskAversion: 1, scheduleConflict: 1, agendaInterest: 1 },
      exposure: { k1: 1, k2: 1, k3: 1 },
      turn: { w1: 1, w2: 1, w3: 1, w4: 1, w5: 1 },
    },
  });
  return { content, preset: STANDARD, scenario, cityData, descriptors, publicTexts };
}

function game(seed: string): WorldState {
  return generateGame(seed, inputs()).world;
}

// The world the records are overlaid on, and a world off a DIFFERENT seed whose
// ground-truth slices the twin borrows, so the twin's truth genuinely differs
// while its records are identical.
const BASE: WorldState = game('player-quotes-alpha');
const OTHER: WorldState = game('player-quotes-beta');

const NPC_IDS: readonly NpcId[] = (Object.keys(BASE.npcs) as NpcId[]).sort();
const LOC_IDS: readonly LocId[] = (
  Object.keys(BASE.city.locations) as LocId[]
).sort();

if (NPC_IDS.length < 4) {
  throw new Error('the generated world has fewer than four NPCs');
}
if (LOC_IDS.length < 1) {
  throw new Error('the generated world has no Locations');
}

// An NPC id that is not a real NPC of the world: a `task` over it must quote the
// same way (disallowed) regardless of truth.
const ABSENT_NPC = 'npc:absent-xyz' as NpcId;

// The `unk:` id the optional held alias Claim links to a known NPC.
const ALIAS_PROBE: UnkId = 'unk:700';

const T: GameTime = { day: 0, phase: 0 };

// ---------------------------------------------------------------------------
// The player-side records an arbitrary draws, and the actions sampled
// ---------------------------------------------------------------------------

type AssetForm = 'with-channel' | 'no-channel' | 'recruited-no-profile';

interface AssetRecord {
  readonly npc: NpcId;
  readonly form: AssetForm;
}

interface Records {
  /** NPCs flipped into running Assets, each in one of the three forms. */
  readonly assets: readonly AssetRecord[];
  /** NPCs the player knows by name (in `player.known.entities`). */
  readonly known: readonly NpcId[];
  /** An optional held `IS_ALIAS_OF(unk, npc)` Claim linking an alias to a known NPC. */
  readonly alias?: { readonly unk: UnkId; readonly npc: NpcId };
}

// ---------------------------------------------------------------------------
// Overlay: apply the records (and the Case File) to a world
// ---------------------------------------------------------------------------

/** Build a running-Asset Relationship for `npc` in the requested form. */
function assetRelationship(world: WorldState, record: AssetRecord): Relationship {
  const base: Relationship = { ...newRelationship(record.npc), recruited: true, trust: 0.6 };
  if (record.form === 'recruited-no-profile') {
    // Recruited but with no Asset profile: `isAsset` is false, so a task is
    // disallowed as "not your Asset" — a Relationship-flag decision.
    return base;
  }
  const npc = world.npcs[record.npc];
  const profile = assetProfileFor(npc, world.npcs);
  return {
    ...base,
    asset: profile,
    channel: record.form === 'with-channel',
  };
}

/** Build the Case File the records call for (an optional held alias Claim). */
function buildCaseFile(records: Records): CaseFile {
  const caseFile = new CaseFile();
  if (records.alias) {
    const source: ClaimSource = { kind: 'npc', npc: records.alias.npc };
    const prop: Proposition = {
      id: `alias:${records.alias.unk}->${records.alias.npc}`,
      subject: records.alias.unk,
      predicate: 'IS_ALIAS_OF',
      object: records.alias.npc,
    };
    caseFile.add({ source, prop, observedAt: T });
  }
  return caseFile;
}

/**
 * Overlay the records on `world`: flip the chosen Relationships into running
 * Assets (in their requested form) and set `player.known.entities`. Nothing
 * truth-bearing that the player cannot see is touched beyond the Asset profile
 * (whose `Truth`-branded fields the twin rewrites), so the same overlay on the
 * base world and on its truth-mutated twin differ only in ground truth.
 */
function overlay(world: WorldState, records: Records): WorldState {
  const relationships = { ...world.relationships };
  for (const record of records.assets) {
    relationships[record.npc] = assetRelationship(world, record);
  }
  return {
    ...world,
    relationships,
    player: {
      ...world.player,
      known: { ...world.player.known, entities: [...records.known] },
    },
  };
}

/**
 * A truth-mutated twin of {@link BASE}: identical in every record the player can
 * see, but with ground truth rewritten. Every NPC's `trueAllegiance` is flipped
 * to a sentinel borrowed from another seed, the plot and hostile truth slices
 * come from that other seed, and the player's truth-branded cover fields are
 * flipped. The overlay is applied on top, so the records on this twin match the
 * records on the base state exactly. The overlaid Asset profiles' own
 * `Truth`-branded fields are flipped afterward, so even the hidden profile truth
 * differs between the two states.
 */
function truthMutatedTwin(): WorldState {
  const sentinelAllegiance = OTHER.npcs[Object.keys(OTHER.npcs)[0] as NpcId].trueAllegiance;
  const npcs = { ...BASE.npcs };
  for (const id of NPC_IDS) {
    npcs[id] = { ...BASE.npcs[id], trueAllegiance: sentinelAllegiance };
  }
  return {
    ...BASE,
    npcs,
    plot: OTHER.plot,
    hostile: OTHER.hostile,
    player: {
      ...BASE.player,
      coverSuspicion: asTruth((BASE.player.coverSuspicion as number) + 0.5),
      tailed: asTruth(!(BASE.player.tailed as boolean)),
      burned: !BASE.player.burned,
    },
  };
}

const TWIN_BASE: WorldState = truthMutatedTwin();

/**
 * After overlaying the records, flip every running Asset's `Truth`-branded
 * profile fields (access, reliability, `hostileControlled`) so the twin's hidden
 * Asset truth genuinely differs from the base's. The quote reads none of these,
 * so this must not change the answer — which is exactly what the property asserts.
 */
function mutateAssetTruth(state: WorldState): WorldState {
  const relationships = { ...state.relationships };
  for (const [npc, rel] of Object.entries(relationships) as [NpcId, Relationship][]) {
    if (rel.asset === undefined) continue;
    const access = revealTruth(rel.asset.access);
    relationships[npc] = {
      ...rel,
      asset: {
        ...rel.asset,
        access: asTruth({ ...access, npcs: [...access.npcs].reverse() }),
        reliability: asTruth(1 - (revealTruth(rel.asset.reliability) as number)),
        hostileControlled: asTruth(!revealTruth(rel.asset.hostileControlled)),
      },
    };
  }
  return { ...state, relationships };
}

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

const RUNS = 150;

const npcArb: fc.Arbitrary<NpcId> = fc.constantFrom(...NPC_IDS);
const locArb: fc.Arbitrary<LocId> = fc.constantFrom(...LOC_IDS);

const assetFormArb = fc.constantFrom<AssetForm>(
  'with-channel',
  'no-channel',
  'recruited-no-profile',
);

const recordsArb: fc.Arbitrary<Records> = fc
  .record({
    assets: fc.uniqueArray(
      fc.record({ npc: npcArb, form: assetFormArb }),
      { maxLength: NPC_IDS.length, selector: (r) => r.npc },
    ),
    known: fc.uniqueArray(npcArb, { maxLength: NPC_IDS.length }),
    alias: fc.option(
      fc.record({ unk: fc.constant(ALIAS_PROBE), npc: npcArb }),
      { nil: undefined },
    ),
  });

/** A `task` action over a sampled Asset, with a sampled task payload. */
const taskArb: fc.Arbitrary<TaskAction> = fc.record({
  kind: fc.constant<'task'>('task'),
  asset: fc.oneof(npcArb as fc.Arbitrary<NpcId>, fc.constant(ABSENT_NPC)),
  task: fc.oneof(
    fc.record({ kind: fc.constant<'collect'>('collect'), target: npcArb }),
    fc.record({ kind: fc.constant<'introduce'>('introduce'), target: npcArb }),
  ),
});

/**
 * A single composed feed item over sampled entities. The entities span the
 * known set, the alias probe, plain NPC ids and an absent one, so both the
 * valid and the invalid known-set branches occur.
 */
function composedArb(): fc.Arbitrary<FeedItem> {
  const entityArb: fc.Arbitrary<EntityId> = fc.oneof(
    npcArb as fc.Arbitrary<EntityId>,
    fc.constantFrom<EntityId>(ALIAS_PROBE, ABSENT_NPC),
  );
  const composed: fc.Arbitrary<ComposedProposition> = fc.record({
    predicate: fc.constantFrom('MEETS_AT', 'KNOWS', 'MEMBER_OF'),
    subject: entityArb,
    object: fc.oneof(entityArb, locArb as fc.Arbitrary<EntityId>),
    place: fc.option(locArb, { nil: undefined }),
  });
  return composed.map((prop) => ({ from: 'composed', prop }));
}

/** A feed item list of 0–4 items (so the 1–3 count rule is exercised on both sides). */
const feedItemsArb: fc.Arbitrary<readonly FeedItem[]> = fc.array(composedArb(), {
  maxLength: 4,
});

const caseArb = fc.record({
  records: recordsArb,
  tasks: fc.array(taskArb, { minLength: 1, maxLength: 8 }),
  feeds: fc.array(feedItemsArb, { minLength: 1, maxLength: 6 }),
});

// ---------------------------------------------------------------------------
// Property 47 (Req 10.2, 14.3)
// ---------------------------------------------------------------------------

describe('Property 47: Player-side quotes are truth-independent', () => {
  it('quotes `task` the same on a base world and a truth-mutated twin (Req 10.2)', () => {
    fc.assert(
      fc.property(caseArb, ({ records, tasks }) => {
        const onBase = overlay(BASE, records);
        const onTwin = mutateAssetTruth(overlay(TWIN_BASE, records));

        for (const action of tasks) {
          const baseQuote = quoteTask(onBase, action);
          const twinQuote = quoteTask(onTwin, action);
          // `allowed`, `reason`, `phases` and `money` must all match.
          expect(twinQuote).toEqual(baseQuote);
          // And an allowed task always quotes the fixed, truth-free cost.
          if (baseQuote.allowed) {
            expect(baseQuote.phases).toBe(TASK_PHASE_COST);
            expect(baseQuote.money).toBe(TASK_MONEY_COST);
          }
        }
      }),
      { numRuns: RUNS },
    );
  });

  it('validates feeds the same on a base world and a truth-mutated twin (Req 14.3)', () => {
    fc.assert(
      fc.property(caseArb, ({ records, feeds }) => {
        const caseFile = buildCaseFile(records);
        const baseView = feedView({ state: overlay(BASE, records), caseFile });
        const twinView = feedView({
          state: mutateAssetTruth(overlay(TWIN_BASE, records)),
          caseFile,
        });

        for (const items of feeds) {
          const baseResult = validateFeedItems(items, baseView, content);
          const twinResult = validateFeedItems(items, twinView, content);
          expect(twinResult.ok).toBe(baseResult.ok);
          if (!baseResult.ok && !twinResult.ok) {
            // The same failures, in the same order, with the same fields.
            expect(twinResult.error).toEqual(baseResult.error);
          }
        }
      }),
      { numRuns: RUNS },
    );
  });
});
