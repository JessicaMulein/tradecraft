/**
 * Feature: slice-integration, Property 44: Every action kind resolvable.
 *
 * **Validates: Requirements 11.1, 11.3, 11.4**
 *
 * The design states (slice-integration design, "Property 44: Every action kind
 * resolvable"): for any reachable state and any action of any kind in the
 * `Action` union (with generated, possibly nonsensical arguments), `quote`
 * returns without throwing and a disallowed quote carries a non-empty reason;
 * for any allowed action, `resolve` returns without throwing, and the turn
 * changes the Budget by exactly the quoted money and advances the clock by
 * exactly the quoted phases — which, since `resolve` leaves the clock for the
 * Turn Pipeline, means `next.time === state.time` and the ledger moves by
 * exactly `quote.money` (slice Property 16, Req 11.4). A disallowed action
 * leaves `next === state` by reference and sets no `ended`.
 *
 * ## How the property sweeps the Action union
 *
 * `action.spec.ts` already drives one nonsense action *per kind* through a
 * single generated world (slice-integration task 2.4/2.6: "every kind
 * dispatched"). This property turns that example into a **sweep**: a pool of
 * worlds generated from a seed list — "all generated world states" — crossed
 * with every {@link ActionKind} and a few staged variations (the player at the
 * Station, an Asset Relationship) so more kinds reach their *allowed* branch,
 * and with arguments drawn from each world (a real NPC id, the player's
 * Location, a known drop/channel/intercept/doc/claim) or deliberately
 * nonsensical, chosen by the arbitrary.
 *
 * Every kind is enumerated through a {@link Record} keyed by {@link ActionKind},
 * so adding a kind to the union fails to compile until this sweep covers it.
 *
 * The property is "never throws, a refusal carries a reason, an allowed action
 * costs exactly what it quoted" — it holds whether a given random case lands in
 * the allowed or the disallowed branch, so it is fine (and expected) for most
 * random cases to be disallowed. A kind that *throws* from `quote` or `resolve`
 * is a real bug.
 *
 * The core-pack load, the `GenerateInputs`/`ScenarioConfig` construction and the
 * reachable-with-core-pack staging (at the Station, a running Asset) mirror
 * `action.spec.ts`; the fast-check shape (a seeded `fc.record`, a bounded
 * `numRuns`, a world pool built up front) mirrors the engine's other
 * `*.property.spec.ts` files.
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
  type ContentSet,
  type DifficultyPreset,
} from '@tradecraft/content';

import { ScenarioConfigSchema } from '../config/scenario-config.js';
import { worldCipherKeyLookup } from '../cipher/world-intercepts.js';
import { generateGame, type GenerateInputs } from '../generate.js';
import type { CipherKeyLookup } from '../cipher/spec.js';
import { revealedSpec } from '../cipher/intercept.js';
import {
  asTruth,
  revealTruth,
  type ChannelId,
  type DeadDropId,
  type DocId,
  type InterceptId,
  type LocId,
  type NpcId,
  type OrgId,
  type Phase,
  type Proposition,
} from '../model/core.js';
import type { WorldState } from '../model/state.js';
import type { TruthStore } from '../truth/truth.js';
import { createPrng } from '../prng/prng.js';
import { balance } from '../station/ledger.js';
import {
  newRelationship,
  type AssetProfile,
  type Relationship,
} from '../recruit/asset.js';
import { quote, resolve, type ResolveResult } from './action.js';
import { isAtStation } from './intercept.js';
import type { Action, ActionKind, FeedItem } from './types.js';
import type { ActionQuote, ResolverContext } from './result.js';

// ---------------------------------------------------------------------------
// Core-pack fixtures (mirrors action.spec.ts / clock-coverage.property.spec.ts)
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

function loadCore(): GenerateInputs {
  const content = loadContent([CORE_DIR], ['core']);
  const cityData = loadCityData(CORE_DIR);
  const descriptors = loadDescriptorData(CORE_DIR);
  const publicTexts = loadPublicTexts(CORE_DIR);
  if (!content.ok || !cityData.ok || !descriptors.ok || !publicTexts.ok) {
    throw new Error('the core pack failed to load');
  }
  const scenario = ScenarioConfigSchema.parse({
    difficulty: { preset: 'standard' },
    mole: false,
    recruitment: {
      pitch: { w1: 1, w2: 1, w3: 1, w4: 1 },
      firstContact: { a: 1, b: 1, c: 1, d: 1 },
      meeting: { trust: 1, riskAversion: 1, scheduleConflict: 1, agendaInterest: 1 },
      exposure: { k1: 1, k2: 1, k3: 1 },
      turn: { w1: 1, w2: 1, w3: 1, w4: 1, w5: 1 },
    },
  });
  return {
    content: content.value,
    preset: presetOf(content.value, 'standard'),
    scenario,
    cityData: cityData.value,
    descriptors: descriptors.value,
    publicTexts: publicTexts.value,
  };
}

function presetOf(content: ContentSet, id: string): DifficultyPreset {
  for (const [key, value] of content.difficultyPresets) {
    if (key === id || key.endsWith(`/${id}`)) {
      return value;
    }
  }
  throw new Error(`no difficulty preset ${id}`);
}

const INPUTS = loadCore();
const CONTENT = INPUTS.content;

// ---------------------------------------------------------------------------
// A pool of generated worlds (the "all generated world states" sweep)
// ---------------------------------------------------------------------------

/**
 * A generated world and the per-world material the resolvers read: its Truth
 * Store (surveil/follow allocate `unk:` ids through it; feed/task read it) and
 * its cipher key lookup (decrypt verifies submissions against it).
 */
interface Pooled {
  readonly seed: string;
  readonly world: WorldState;
  readonly truth: TruthStore;
  readonly cipherKeys: CipherKeyLookup;
}

const SEEDS = [
  'resolvable-alpha',
  'resolvable-bravo',
  'resolvable-charlie',
  'resolvable-delta',
  'resolvable-echo',
] as const;

const POOL: readonly Pooled[] = SEEDS.map((seed) => {
  const game = generateGame(seed, INPUTS);
  return {
    seed,
    world: game.world,
    truth: game.truth,
    cipherKeys: worldCipherKeyLookup(seed, game.world.documents),
  };
});

// ---------------------------------------------------------------------------
// World staging — move the player and give them an Asset so allowed branches
// are reachable (mirrors action.spec.ts's reachable-with-core-pack setups).
// ---------------------------------------------------------------------------

const PHASES: readonly Phase[] = [0, 1, 2, 3];

/** The world's NPC ids, sorted, leaving out the Cell leader (whose arrest ends the game). */
function npcIdsBesidesLeader(state: WorldState): NpcId[] {
  const leader = revealTruth(state.plot.leader);
  return (Object.keys(state.npcs) as NpcId[]).filter((id) => id !== leader).sort();
}

/** The Hostile Service's org id, if the world has one. */
function hostileOrg(state: WorldState): OrgId | undefined {
  return Object.values(state.orgs).find((o) => o.kind === 'hostile')?.id;
}

/** A running Asset with a Contact Channel, as a landed pitch or a turn leaves one. */
function runningAsset(npc: NpcId, turned = false): Relationship {
  const profile: AssetProfile = {
    access: asTruth({ locs: [], orgs: [], npcs: [] }),
    reliability: asTruth(1),
    turned,
    hostileControlled: asTruth(false),
  };
  return { ...newRelationship(npc), recruited: true, channel: true, trust: 0.6, asset: profile };
}

/** `state` with `rel` recorded and its NPC among the player's contacts. */
function withAsset(state: WorldState, rel: Relationship): WorldState {
  return {
    ...state,
    relationships: { ...state.relationships, [rel.npc]: rel },
    player: {
      ...state.player,
      contacts: [...new Set([...state.player.contacts, rel.npc])],
    },
  };
}

/** `state` with entities added to the player's known set. */
function withKnown(state: WorldState, ...ids: readonly WorldState['player']['known']['entities'][number][]): WorldState {
  return {
    ...state,
    player: {
      ...state.player,
      known: {
        ...state.player.known,
        entities: [...new Set([...state.player.known.entities, ...ids])],
      },
    },
  };
}

/** `state` with the clock phase overridden. */
function atPhase(state: WorldState, phase: Phase): WorldState {
  return { ...state, time: { ...state.time, phase } };
}

/** `state` with the player at the Station, if the city has one; otherwise unchanged. */
function atStation(state: WorldState): WorldState {
  for (const loc of (Object.keys(state.city.locations) as LocId[]).sort()) {
    const there: WorldState = { ...state, player: { ...state.player, loc } };
    if (isAtStation(there)) {
      return there;
    }
  }
  return state;
}

/** The staged variations of a pooled world. */
type Variation = 'base' | 'station' | 'asset' | 'station-asset';

/**
 * Build the staged world for a variation, and surface the Asset NPC it added
 * (so a `task`/`pay`/`feed`/`turn-agent` case can target a real Asset). Also
 * marks a hostile org and the leftover NPCs known, so the few kinds that gate on
 * the known set can reach their allowed branch.
 */
function stage(
  pooled: Pooled,
  variation: Variation,
  phase: Phase,
): { readonly state: WorldState; readonly assetNpc?: NpcId } {
  let state = atPhase(pooled.world, phase);
  const others = npcIdsBesidesLeader(state);
  const org = hostileOrg(state);
  if (org !== undefined) {
    state = withKnown(state, org);
  }
  if (others.length > 0) {
    state = withKnown(state, ...others.slice(0, 4));
  }

  const wantsStation = variation === 'station' || variation === 'station-asset';
  const wantsAsset = variation === 'asset' || variation === 'station-asset';

  if (wantsStation) {
    state = atStation(state);
  }

  let assetNpc: NpcId | undefined;
  if (wantsAsset && others.length > 0) {
    assetNpc = others[0];
    // A turned Asset so the `feed` branch is reachable too.
    state = withAsset(state, runningAsset(assetNpc, true));
  }
  return { state, assetNpc };
}

// ---------------------------------------------------------------------------
// Per-world ids for drawing real-ish arguments
// ---------------------------------------------------------------------------

function firstKey<K extends string>(record: Record<K, unknown>): K | undefined {
  return (Object.keys(record) as K[]).sort()[0];
}

/** A per-world pick of real ids an action can name, with safe fallbacks. */
interface Picks {
  readonly npc: NpcId | 'npc:nobody';
  readonly otherNpc: NpcId | 'npc:nobody';
  readonly loc: LocId;
  readonly otherLoc: LocId;
  readonly channel: ChannelId | 'chan:none';
  readonly drop: DeadDropId | 'drop:none';
  readonly intercept: InterceptId | 'int:none';
  readonly doc: DocId | 'doc:none';
  readonly org: OrgId | undefined;
}

function picksOf(state: WorldState): Picks {
  const npcs = npcIdsBesidesLeader(state);
  const locs = (Object.keys(state.city.locations) as LocId[]).sort();
  const otherLoc = locs.find((l) => l !== state.player.loc) ?? locs[0];
  const intercept = state.transmissions[0]?.intercept.id;
  return {
    npc: npcs[0] ?? 'npc:nobody',
    otherNpc: npcs[1] ?? npcs[0] ?? 'npc:nobody',
    loc: state.player.loc,
    otherLoc,
    channel: firstKey(state.channels) ?? 'chan:none',
    drop: firstKey(state.deadDrops) ?? 'drop:none',
    intercept: intercept ?? 'int:none',
    doc: firstKey(state.documents) ?? 'doc:none',
    org: hostileOrg(state),
  };
}

// ---------------------------------------------------------------------------
// Build one action of each kind, drawing on `picks` or on nonsense
// ---------------------------------------------------------------------------

/**
 * A builder per kind. `real` draws arguments from the world (so the allowed
 * branch is reachable); when `real` is false, it names nothing in the world or
 * is out of range (so the disallowed branch is exercised). Keyed by
 * {@link ActionKind}, so a new kind in the union fails to compile here until it
 * is covered.
 */
type ActionBuilders = {
  readonly [K in ActionKind]: (
    state: WorldState,
    picks: Picks,
    assetNpc: NpcId | undefined,
    real: boolean,
  ) => Extract<Action, { kind: K }>;
};

const BUILDERS: ActionBuilders = {
  talk: (_s, p, _a, real) => ({ kind: 'talk', npc: real ? p.npc : 'npc:nobody' }),
  approach: (_s, p, _a, real) => ({ kind: 'approach', npc: real ? p.npc : 'npc:nobody' }),
  travel: (_s, p, _a, real) => ({
    kind: 'travel',
    to: real ? p.otherLoc : ('loc:nowhere' as LocId),
    countersurveillance: false,
  }),
  'arrange-meeting': (s, p, _a, real) => ({
    kind: 'arrange-meeting',
    npc: real ? p.npc : 'npc:nobody',
    at: real ? p.loc : ('loc:nowhere' as LocId),
    slot: s.time,
  }),
  surveil: (_s, p, _a, real) => ({ kind: 'surveil', at: real ? p.loc : ('loc:nowhere' as LocId), phases: 1 }),
  follow: (_s, p, _a, real) => ({ kind: 'follow', target: real ? p.npc : 'npc:nobody' }),
  'service-drop': (_s, p, _a, real) => ({
    kind: 'service-drop',
    drop: real ? p.drop : ('drop:none' as DeadDropId),
    leave: [],
  }),
  intercept: (_s, p, _a, real) => ({ kind: 'intercept', channel: real ? p.channel : ('chan:none' as ChannelId) }),
  decrypt: (s, p, _a, real) => {
    if (real && p.intercept !== 'int:none') {
      const int = s.transmissions[0]?.intercept;
      if (int !== undefined) {
        return { kind: 'decrypt', intercept: int.id, submission: { kind: 'key', spec: revealedSpec(int) } };
      }
    }
    return {
      kind: 'decrypt',
      intercept: real ? p.intercept : ('int:none' as InterceptId),
      submission: { kind: 'plaintext', text: '' },
    };
  },
  read: (_s, p, _a, real) => ({ kind: 'read', doc: real ? p.doc : ('doc:none' as DocId) }),
  cable: (_s, p, _a, real) => ({
    kind: 'cable',
    body: real ? { kind: 'report', body: 'All quiet.' } : { kind: 'trace', target: 'npc:nobody' },
  }),
  task: (_s, p, a, real) => ({
    kind: 'task',
    asset: real ? a ?? p.npc : 'npc:nobody',
    task: { kind: 'collect', target: real ? p.otherNpc : 'npc:nobody' },
  }),
  pay: (_s, p, a, real) => ({
    kind: 'pay',
    npc: real ? a ?? p.npc : 'npc:nobody',
    amount: real ? 100 : -1,
  }),
  confront: (_s, p, _a, real) => ({
    kind: 'confront',
    npc: real ? p.npc : 'npc:nobody',
    claim: 'claim:resolvable',
  }),
  arrest: (_s, p, _a, real) => ({ kind: 'arrest', npc: real ? p.npc : 'npc:nobody' }),
  'turn-agent': (_s, p, a, real) =>
    real
      ? { kind: 'turn-agent', npc: a ?? p.npc, lever: 'coercion' }
      : { kind: 'turn-agent', npc: 'npc:nobody', lever: 'money', offer: Number.NaN },
  feed: (_s, p, a, real) => {
    const items: readonly FeedItem[] =
      real && p.org !== undefined
        ? [{ from: 'composed', prop: { predicate: 'MEMBER_OF', subject: p.otherNpc, object: p.org } }]
        : [];
    return { kind: 'feed', asset: real ? a ?? p.npc : 'npc:nobody', items };
  },
  wait: () => ({ kind: 'wait', phases: 1 }),
};

/** Every kind, sorted, so the sweep is deterministic. */
const KINDS = (Object.keys(BUILDERS) as ActionKind[]).sort();

// ---------------------------------------------------------------------------
// Resolver context — carry what each kind reads so allowed branches are real
// ---------------------------------------------------------------------------

/**
 * Build the {@link ResolverContext} for a case. Every kind gets `content`;
 * decrypt gets the world's cipher keys; feed/confront get a projected Claim
 * store; arrest gets an evidence count at the preset threshold; the Truth Store
 * is supplied so surveil/follow can allocate `unk:` ids.
 */
function contextFor(pooled: Pooled, state: WorldState, action: Action): ResolverContext {
  const base: ResolverContext = {
    content: CONTENT,
    truth: pooled.truth,
    cipherKeys: pooled.cipherKeys,
  };
  if (action.kind === 'confront') {
    const prop: Proposition = {
      id: 'prop:resolvable',
      subject: action.npc,
      predicate: 'MEMBER_OF',
      object: hostileOrg(state) ?? ({ kind: 'text', value: 'x' } as Proposition['object']),
    };
    return { ...base, claims: { 'claim:resolvable': prop } };
  }
  if (action.kind === 'feed') {
    return { ...base, claims: {} };
  }
  if (action.kind === 'arrest') {
    const threshold = INPUTS.preset.arrest.threshold;
    return { ...base, arrestEvidence: { [action.npc]: threshold } };
  }
  return base;
}

// ---------------------------------------------------------------------------
// The core assertion: never throws, a refusal has a reason, cost is exact
// ---------------------------------------------------------------------------

function checkQuoteShape(q: ActionQuote, kind: ActionKind): void {
  expect(Number.isFinite(q.phases), `${kind} phases finite`).toBe(true);
  expect(q.phases, `${kind} phases non-negative`).toBeGreaterThanOrEqual(0);
  expect(Number.isFinite(q.money), `${kind} money finite`).toBe(true);
  expect(q.money, `${kind} money non-negative`).toBeGreaterThanOrEqual(0);
  // A refusal is never silent (Req 11.3), and never the removed stub reason.
  if (q.allowed === false) {
    expect(typeof q.reason, `${kind} reason`).toBe('string');
    expect((q.reason ?? '').length, `${kind} reason non-empty`).toBeGreaterThan(0);
  }
  expect(q.reason ?? '', `${kind} not-implemented`).not.toContain('not yet implemented');
}

/** Assert the cost contract on an allowed resolve (slice Property 16, Req 11.4). */
function checkAllowedCost(state: WorldState, q: ActionQuote, out: ResolveResult, kind: ActionKind): void {
  // resolve leaves the clock for the Turn Pipeline.
  expect(out.next.time, `${kind} time unchanged`).toEqual(state.time);
  // The ledger moved by exactly the quoted money.
  expect(balance(out.next.station.ledger), `${kind} ledger delta`).toBe(
    balance(state.station.ledger) - q.money,
  );
}

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

const RUNS = 200;

const caseArb = fc.record({
  seedIndex: fc.integer({ min: 0, max: POOL.length - 1 }),
  variation: fc.constantFrom<Variation>('base', 'station', 'asset', 'station-asset'),
  phase: fc.constantFrom<Phase>(...PHASES),
  kind: fc.constantFrom<ActionKind>(...KINDS),
  real: fc.boolean(),
  prngSeed: fc.string({ minLength: 1, maxLength: 12 }),
});

// ---------------------------------------------------------------------------
// Property 44 — Every action kind resolvable
// ---------------------------------------------------------------------------

describe('Property 44: Every action kind resolvable (Req 11.1, 11.3, 11.4)', () => {
  it('quotes without throwing and carries a reason on refusal, for every kind, world and staging', () => {
    fc.assert(
      fc.property(caseArb, ({ seedIndex, variation, phase, kind, real, prngSeed }) => {
        const pooled = POOL[seedIndex];
        const { state, assetNpc } = stage(pooled, variation, phase);
        const picks = picksOf(state);
        const action = BUILDERS[kind](state, picks, assetNpc, real) as Action;
        const ctx = contextFor(pooled, state, action);

        // quote never throws (Req 11.1) and a refusal carries a reason (Req 11.3).
        const q = quote(state, action, ctx);
        checkQuoteShape(q, kind);

        // resolve never throws (Req 11.1).
        const out = resolve(state, action, createPrng(`${kind}-${prngSeed}`), ctx);

        if (q.allowed) {
          // Allowed: exact cost, clock left for the pipeline (Req 11.4).
          checkAllowedCost(state, q, out, kind);
        } else {
          // Disallowed: the state is untouched, by reference, and nothing ended.
          expect(out.next, `${kind} next===state`).toBe(state);
          expect(out.ended, `${kind} no ended`).toBeUndefined();
        }
      }),
      { numRuns: RUNS },
    );
  });

  it('covers every ActionKind across the sweep', () => {
    // A guard that the enumeration above really is the whole union: the builder
    // keys are exactly the kinds, and a kind added to `Action` without a builder
    // fails to compile in `BUILDERS`.
    const seen = new Set<ActionKind>(KINDS);
    for (const pooled of POOL) {
      const { state, assetNpc } = stage(pooled, 'station-asset', 0);
      const picks = picksOf(state);
      for (const kind of KINDS) {
        const action = BUILDERS[kind](state, picks, assetNpc, true) as Action;
        expect(action.kind).toBe(kind);
        seen.delete(action.kind);
        seen.add(action.kind);
      }
    }
    expect([...seen].sort()).toEqual(KINDS);
  });
});
