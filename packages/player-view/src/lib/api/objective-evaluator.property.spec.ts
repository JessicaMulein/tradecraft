/**
 * Feature: slice-integration, Property 49: Objective Evaluator truth
 * independence.
 *
 * **Validates: Requirements 6.2, 6.3, 6.5**
 *
 * The design states (slice-integration design, "Property 49: Objective
 * Evaluator truth independence"): for any reachable state, Case File and
 * Directive objective, the evaluator's result equals the model rule for its
 * kind
 *
 *  - `identify` — the entity is in the known set by name (or an `unk:` id
 *    resolves to a known id through a held `IS_ALIAS_OF` Claim);
 *  - `recruit`  — the count of recruited Relationships is at least `n`;
 *  - `arrest`   — the entity is in `player.arrests` (by its id or by the `unk:`
 *    id the player knows it by);
 *  - `intercept`— a collected Intercept is on the Channel,
 *
 * and is unchanged under any modification of the Truth Store that leaves the
 * player's recorded actions unchanged (Req 6.3, 6.5): the result is a function
 * of the player's recorded records (`relationships[*].recruited`,
 * `player.arrests`, `player.unkIds`, `player.known`, `intercepts[*].channel`)
 * and the Case File, never of ground truth.
 *
 * ## Shape of the two checks
 *
 * An arbitrary draws a set of player-progress records over the generated world:
 * a random subset of Relationships flipped `recruited`, a random `player.arrests`
 * (some by NPC id, some by the player's `unk:` alias), a random set of collected
 * Intercepts on real Channels, a random known set, and an optional held
 * `IS_ALIAS_OF` Claim on the Case File. It also draws a battery of objectives of
 * all four kinds (named by both NPC ids and `unk:` aliases, over real and absent
 * Channels, with recruit counts that straddle the recruited total).
 *
 * **Property A — truth independence.** The records and Case File are overlaid on
 * the base world to make one state, and on a *truth-mutated twin* of the base
 * world — a world identical in exactly those recorded records but with ground
 * truth rewritten (every NPC's `trueAllegiance`, the plot/hostile truth slices
 * swapped in from a world generated off a DIFFERENT seed, and the player's
 * truth-branded cover fields flipped) — to make a second state. The two
 * evaluators are asserted to agree on every sampled objective. Changing truth
 * without changing the records cannot change any result.
 *
 * **Property B — the records drive the result (an independent oracle).** For the
 * same overlaid state, an oracle computed straight from the records and Case
 * File (recruited total ≥ count; entity ∈ arrests by id or alias; a collected
 * intercept on the channel; entity known or alias-resolved) is asserted equal to
 * the evaluator for every sampled objective. This is the cross-check that the
 * evaluator reads exactly those records and nothing else.
 *
 * The core-pack fixture pattern mirrors `objective-evaluator.spec.ts` and
 * `resolver-projection.spec.ts`; the fast-check shape mirrors the engine
 * `*.property.spec.ts` files (e.g. `clock/disruption-agreement.property.spec.ts`).
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
  generateGame,
  newRelationship,
  ScenarioConfigSchema,
  type ChannelId,
  type DirectiveObjective,
  type EntityId,
  type GameTime,
  type GenerateInputs,
  type Intercept,
  type InterceptId,
  type NpcId,
  type Proposition,
  type UnkId,
  type WorldState,
} from '@tradecraft/engine';

import { CaseFile, type ClaimSource } from '../casefile/casefile.js';
import { buildObjectiveEvaluator } from './objective-evaluator.js';

// ---------------------------------------------------------------------------
// Core-pack fixtures (mirrors objective-evaluator.spec.ts)
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
// ground-truth slices the twin borrows (different allegiances, plot and hostile
// state) so the twin's truth genuinely differs while its records are identical.
const BASE: WorldState = game('objective-evaluator-alpha');
const OTHER: WorldState = game('objective-evaluator-beta');

const NPC_IDS: readonly NpcId[] = (Object.keys(BASE.npcs) as NpcId[]).sort();
const CHANNEL_IDS: readonly ChannelId[] = (
  Object.keys(BASE.channels) as ChannelId[]
).sort();

if (NPC_IDS.length < 3) {
  throw new Error('the generated world has fewer than three NPCs');
}
if (CHANNEL_IDS.length < 2) {
  throw new Error('the generated world has fewer than two Channels');
}

// A Channel id that is not a real Channel of the world: an `intercept` objective
// over it can only ever be met by a collected Intercept the records place there.
const ABSENT_CHANNEL = 'chan:absent-xyz' as ChannelId;

// The `unk:` id the optional held alias Claim links to a known NPC.
const ALIAS_PROBE: UnkId = 'unk:500';

const T: GameTime = { day: 0, phase: 0 };

// ---------------------------------------------------------------------------
// The player-progress records an arbitrary draws, and the objectives sampled
// ---------------------------------------------------------------------------

type ArrestForm = 'by-id' | 'by-alias';

interface Records {
  /** NPCs whose Relationship is flipped `recruited`. */
  readonly recruited: readonly NpcId[];
  /** NPCs the Station has arrested, each recorded by its id or its `unk:` alias. */
  readonly arrests: readonly { readonly npc: NpcId; readonly form: ArrestForm }[];
  /** Real Channels the player has collected an Intercept off. */
  readonly intercepts: readonly ChannelId[];
  /** NPCs the player has identified by name (in `player.known.entities`). */
  readonly known: readonly NpcId[];
  /** An optional held `IS_ALIAS_OF(unk, npc)` Claim linking an alias to a known NPC. */
  readonly alias?: { readonly unk: UnkId; readonly npc: NpcId };
}

/** The sampled objectives, named so Property A and B can share them. */
interface Objectives {
  readonly identify: readonly EntityId[];
  readonly recruit: readonly number[];
  readonly arrest: readonly EntityId[];
  readonly intercept: readonly ChannelId[];
}

const identify = (entity: EntityId): DirectiveObjective => ({ kind: 'identify', entity });
const recruit = (count: number): DirectiveObjective => ({ kind: 'recruit', count });
const arrest = (entity: EntityId): DirectiveObjective => ({ kind: 'arrest', entity });
const intercept = (channel: ChannelId): DirectiveObjective => ({ kind: 'intercept', channel });

/** Every sampled objective, flattened for a single agreement loop. */
function allObjectives(o: Objectives): readonly DirectiveObjective[] {
  return [
    ...o.identify.map(identify),
    ...o.recruit.map(recruit),
    ...o.arrest.map(arrest),
    ...o.intercept.map(intercept),
  ];
}

// ---------------------------------------------------------------------------
// Overlay: apply the records (and the Case File) to a world
// ---------------------------------------------------------------------------

/** The `unk:` alias assigned to the `i`-th aliased arrest. */
function arrestAlias(index: number): UnkId {
  return `unk:${900 + index}`;
}

/**
 * A collected Intercept captured off `channel`. The evaluator reads only
 * `channel`, so the heavy Truth-bearing fields are stubbed behind one localised
 * cast (as in `objective-evaluator.spec.ts`).
 */
function interceptOn(id: InterceptId, channel: ChannelId): Intercept {
  return { id, channel } as unknown as Intercept;
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
 * Overlay the records on `world`: flip the `recruited` Relationships, write
 * `player.arrests` (recording the aliased ones under a fresh `unk:` id in
 * `player.unkIds`), add the collected Intercepts, and set `player.known.entities`.
 * Nothing truth-bearing is touched, so the same overlay on the base world and on
 * its truth-mutated twin differ only in ground truth.
 */
function overlay(world: WorldState, records: Records): WorldState {
  const relationships = { ...world.relationships };
  for (const npc of records.recruited) {
    const rel = relationships[npc] ?? newRelationship(npc);
    relationships[npc] = { ...rel, recruited: true };
  }

  const unkIds = { ...world.player.unkIds };
  const arrests: EntityId[] = [];
  let aliasSeq = 1;
  for (const entry of records.arrests) {
    if (entry.form === 'by-id') {
      arrests.push(entry.npc);
    } else {
      const alias = arrestAlias(aliasSeq);
      aliasSeq += 1;
      unkIds[entry.npc] = alias;
      arrests.push(alias);
    }
  }

  const intercepts = { ...world.intercepts };
  records.intercepts.forEach((channel, i) => {
    const id = `int:overlay-${i}` as InterceptId;
    intercepts[id] = interceptOn(id, channel);
  });

  return {
    ...world,
    relationships,
    intercepts,
    player: {
      ...world.player,
      unkIds,
      arrests,
      known: { ...world.player.known, entities: [...records.known] },
    },
  };
}

/**
 * A truth-mutated twin of {@link BASE}: identical in every record the evaluator
 * reads, but with ground truth rewritten. Every NPC's `trueAllegiance` is
 * flipped to a sentinel, the plot and hostile truth slices are swapped in from a
 * world generated off a different seed, and the player's truth-branded cover
 * fields are flipped. The overlay is applied on top, so the records on this twin
 * match the records on the base state exactly.
 */
function truthMutatedTwin(): WorldState {
  // A real `Truth<Allegiance>` borrowed from the other-seed world, so the
  // rewritten allegiance is a valid value yet differs from the base truth.
  const sentinelAllegiance = OTHER.npcs[Object.keys(OTHER.npcs)[0] as NpcId].trueAllegiance;
  const npcs = { ...BASE.npcs };
  for (const id of NPC_IDS) {
    npcs[id] = { ...BASE.npcs[id], trueAllegiance: sentinelAllegiance };
  }
  return {
    ...BASE,
    npcs,
    // Different ground truth wholesale: the plot (leader/target/materiel truth)
    // and hostile (mole, beliefs, chickenfeed) slices come from another seed.
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

// ---------------------------------------------------------------------------
// Independent oracle — read straight from the records + Case File (Property B)
// ---------------------------------------------------------------------------

/**
 * The expected result for one objective, computed from the records and Case
 * File alone — never by calling {@link buildObjectiveEvaluator}. Mirrors the
 * model rule in the design's Property 49 statement.
 */
function oracle(objective: DirectiveObjective, records: Records): boolean {
  switch (objective.kind) {
    case 'recruit':
      return records.recruited.length >= objective.count;
    case 'intercept':
      return records.intercepts.includes(objective.channel);
    case 'arrest':
      return oracleArrested(objective.entity, records);
    case 'identify':
      return oracleIdentified(objective.entity, records);
  }
}

/** `arrest`: the entity is in the record by its own id or by its `unk:` alias. */
function oracleArrested(entity: EntityId, records: Records): boolean {
  let aliasSeq = 1;
  for (const entry of records.arrests) {
    if (entry.form === 'by-id') {
      if (entry.npc === entity) return true;
    } else {
      const alias = arrestAlias(aliasSeq);
      aliasSeq += 1;
      // Named directly by the recorded `unk:` id, or by the NPC it aliases.
      if (alias === entity || entry.npc === entity) return true;
    }
  }
  return false;
}

/**
 * `identify`: the entity is known by name, or it is the alias/known pair of a
 * held `IS_ALIAS_OF` Claim where the far side is known (so a `unk:` id resolves
 * to a known NPC, and the known NPC resolves from the `unk:` side too).
 */
function oracleIdentified(entity: EntityId, records: Records): boolean {
  const known = new Set<EntityId>(records.known);
  if (known.has(entity)) return true;
  if (records.alias) {
    const { unk, npc } = records.alias;
    // The alias links `unk` and `npc`; the pair is identified when either side
    // is in the known set, and then both ids read as identified.
    const pairKnown = known.has(npc) || known.has(unk);
    if (pairKnown && (entity === unk || entity === npc)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

const RUNS = 180;

const npcArb: fc.Arbitrary<NpcId> = fc.constantFrom(...NPC_IDS);
const channelArb: fc.Arbitrary<ChannelId> = fc.constantFrom(...CHANNEL_IDS);

const arrestEntryArb = fc.record({
  npc: npcArb,
  form: fc.constantFrom<ArrestForm>('by-id', 'by-alias'),
});

const recordsArb: fc.Arbitrary<Records> = fc.record({
  recruited: fc.uniqueArray(npcArb, { maxLength: NPC_IDS.length }),
  // Arrests may name the same NPC more than once under different forms, so this
  // is not a unique array; a modest cap keeps the alias sequence small.
  arrests: fc.array(arrestEntryArb, { maxLength: 5 }),
  intercepts: fc.uniqueArray(channelArb, { maxLength: CHANNEL_IDS.length }),
  known: fc.uniqueArray(npcArb, { maxLength: NPC_IDS.length }),
  alias: fc.option(
    fc.record({ unk: fc.constant(ALIAS_PROBE), npc: npcArb }),
    { nil: undefined },
  ),
});

/**
 * Objectives spanning all four kinds. `identify` and `arrest` name both NPC ids
 * and `unk:` aliases (the alias-probe id, and the arrest alias ids) so the
 * alias-resolving paths are exercised. `recruit` counts straddle 0..N+1 so both
 * the met and unmet sides occur. `intercept` names real Channels and an absent
 * one.
 */
const objectivesArb: fc.Arbitrary<Objectives> = fc.record({
  identify: fc.uniqueArray(
    fc.oneof(
      npcArb as fc.Arbitrary<EntityId>,
      fc.constantFrom<EntityId>(ALIAS_PROBE, arrestAlias(1), arrestAlias(2)),
    ),
    { minLength: 1, maxLength: NPC_IDS.length + 3 },
  ),
  recruit: fc.uniqueArray(fc.integer({ min: 0, max: NPC_IDS.length + 1 }), {
    minLength: 1,
    maxLength: NPC_IDS.length + 2,
  }),
  arrest: fc.uniqueArray(
    fc.oneof(
      npcArb as fc.Arbitrary<EntityId>,
      fc.constantFrom<EntityId>(arrestAlias(1), arrestAlias(2), arrestAlias(3)),
    ),
    { minLength: 1, maxLength: NPC_IDS.length + 3 },
  ),
  intercept: fc.uniqueArray(
    fc.oneof(channelArb as fc.Arbitrary<ChannelId>, fc.constant(ABSENT_CHANNEL)),
    { minLength: 1, maxLength: CHANNEL_IDS.length + 1 },
  ),
});

const caseArb = fc.record({ records: recordsArb, objectives: objectivesArb });

// ---------------------------------------------------------------------------
// Property 49 (Req 6.2, 6.3, 6.5)
// ---------------------------------------------------------------------------

describe('Property 49: Objective Evaluator truth independence', () => {
  it('agrees on every objective between the base world and a truth-mutated twin (Req 6.3, 6.5)', () => {
    fc.assert(
      fc.property(caseArb, ({ records, objectives }) => {
        const caseFile = buildCaseFile(records);

        // Same records + Case File, two worlds that differ only in ground truth.
        const onBase = buildObjectiveEvaluator({ state: overlay(BASE, records), caseFile });
        const onTwin = buildObjectiveEvaluator({ state: overlay(TWIN_BASE, records), caseFile });

        for (const objective of allObjectives(objectives)) {
          expect(onTwin(objective, T)).toBe(onBase(objective, T));
        }
      }),
      { numRuns: RUNS },
    );
  });

  it('matches the record oracle on every objective (Req 6.2, 6.3)', () => {
    fc.assert(
      fc.property(caseArb, ({ records, objectives }) => {
        const caseFile = buildCaseFile(records);
        const evaluator = buildObjectiveEvaluator({ state: overlay(BASE, records), caseFile });

        for (const objective of allObjectives(objectives)) {
          expect(evaluator(objective, T)).toBe(oracle(objective, records));
        }
      }),
      { numRuns: RUNS },
    );
  });
});
