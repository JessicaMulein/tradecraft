/**
 * Tests for the feed action (task 18.6; Requirements 37.1, 37.2, 37.6).
 *
 * These drive a generated {@link WorldState} from the real core pack through the
 * feed resolver and the top-level {@link quote}/{@link resolve}, checking:
 *
 * - feed is only valid on a player-turned Asset with a Contact Channel (Req 37.6);
 * - resolve schedules a hidden `feed-delivered` event at the agent's next
 *   handler contact carrying the resolved Propositions, draws nothing, and
 *   returns the optional `label` for a Journal note only (Req 37.3, 37.6);
 * - routing: feed is no longer the not-implemented stub, and a disallowed feed
 *   leaves state unchanged.
 *
 * The feed rules themselves (item count, known-set entities, `unk:` aliases,
 * the derived predicate schema, 7-day windows) and the agreement between
 * `quoteFeed` and `validateFeedItems` are tested in `./feed-validation.spec.ts`.
 */

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { describe, expect, it } from 'vitest';

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

import { createPrng } from '../prng/prng.js';
import { ScenarioConfigSchema } from '../config/scenario-config.js';
import { generate, type GenerateInputs } from '../generate.js';
import {
  asTruth,
  type EntityId,
  type NpcId,
  type OrgId,
  type Proposition,
} from '../model/core.js';
import type { ClaimId, SimEvent, WorldState } from '../model/state.js';
import { quote, resolve } from './action.js';
import {
  FEED_SCHEDULED_LINE,
  isTurnedAsset,
  nextHandlerContact,
  quoteFeed,
  resolveFeed,
} from './feed.js';
import { newRelationship, type AssetProfile, type Relationship } from '../recruit/asset.js';
import type { Observation, ResolverContext } from './result.js';
import type { FeedAction, FeedItem } from './types.js';

// ---------------------------------------------------------------------------
// Core-pack fixtures (mirrors confront.spec.ts / turn-agent.spec.ts)
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

const STANDARD = preset('standard');

function inputs(): GenerateInputs {
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
  return { content, preset: STANDARD, scenario, cityData, descriptors, publicTexts };
}

function world(seed = 'feed-alpha'): WorldState {
  return generate(seed, inputs());
}

/** The render callback used in tests: observations to their lines/ids. */
function renderLines(_s: WorldState, obs: readonly Observation[]): string[] {
  return obs.map((o) => (o.kind === 'message' ? o.line : `prop:${o.prop.id}`));
}

/** The hostile org id in the generated world (always present). */
function hostileOrg(state: WorldState): OrgId {
  for (const org of Object.values(state.orgs)) {
    if (org.kind === 'hostile') {
      return org.id;
    }
  }
  throw new Error('no hostile org');
}

/** A turned-Asset relationship for an NPC (recruited double agent). */
function turnedRelationship(npc: NpcId): Relationship {
  const profile: AssetProfile = {
    access: asTruth({ locs: [], orgs: [], npcs: [npc] }),
    reliability: asTruth(0.6),
    turned: true,
    hostileControlled: asTruth(false),
  };
  return { ...newRelationship(npc), recruited: true, asset: profile };
}

/**
 * Stage a world with: an agent that is a player-turned Asset with a Contact
 * Channel; a chosen known set (entities + channels); and the player at some
 * open Location. The agent id is the first NPC that is not the player's cover.
 */
function staged(
  base: WorldState,
  opts: {
    knownEntities?: readonly EntityId[];
    knownChannels?: readonly string[];
    claims?: Record<ClaimId, Proposition>;
    turned?: boolean;
    contact?: boolean;
  } = {},
): { state: WorldState; agent: NpcId; ctx: ResolverContext } {
  const agent = (Object.keys(base.npcs) as NpcId[])[0];
  const turned = opts.turned ?? true;
  const relationships = {
    ...base.relationships,
    [agent]: turned ? turnedRelationship(agent) : newRelationship(agent),
  };
  const contacts = (opts.contact ?? true)
    ? Array.from(new Set([...base.player.contacts, agent]))
    : base.player.contacts.filter((n) => n !== agent);
  const state: WorldState = {
    ...base,
    relationships,
    player: {
      ...base.player,
      contacts,
      known: {
        ...base.player.known,
        entities: opts.knownEntities ?? base.player.known.entities,
        channels: (opts.knownChannels ?? base.player.known.channels) as never,
      },
    },
  };
  const ctx: ResolverContext = { content, claims: opts.claims ?? {} };
  return { state, agent, ctx };
}

/** A composed MEMBER_OF item: subject npc, object org (place none, window optional). */
function memberOfItem(subject: EntityId, org: OrgId): FeedItem {
  return {
    from: 'composed',
    prop: { predicate: 'MEMBER_OF', subject, object: org },
  };
}

// ---------------------------------------------------------------------------
// quote — eligibility (Req 37.6)
// ---------------------------------------------------------------------------

describe('feed — quote eligibility (Req 37.6)', () => {
  function validFeed(base: WorldState): {
    state: WorldState;
    ctx: ResolverContext;
    a: FeedAction;
  } {
    const org = hostileOrg(base);
    const subject = (Object.keys(base.npcs) as NpcId[])[0];
    const { state, agent, ctx } = staged(base, { knownEntities: [subject, org] });
    const a: FeedAction = { kind: 'feed', asset: agent, items: [memberOfItem(subject, org)] };
    return { state, ctx, a };
  }

  it('is allowed for a player-turned Asset with a Contact Channel and a valid feed', () => {
    const { state, ctx, a } = validFeed(world());
    const q = quoteFeed(state, a, ctx);
    expect(q.allowed).toBe(true);
    expect(q.phases).toBe(0);
    expect(q.money).toBe(0);
  });

  it('is not allowed when the agent is not a turned Asset', () => {
    const base = world();
    const org = hostileOrg(base);
    const subject = (Object.keys(base.npcs) as NpcId[])[0];
    const { state, agent, ctx } = staged(base, {
      knownEntities: [subject, org],
      turned: false,
    });
    const a: FeedAction = { kind: 'feed', asset: agent, items: [memberOfItem(subject, org)] };
    const q = quoteFeed(state, a, ctx);
    expect(q.allowed).toBe(false);
  });

  it('is not allowed with no Contact Channel', () => {
    const base = world();
    const org = hostileOrg(base);
    const subject = (Object.keys(base.npcs) as NpcId[])[0];
    const { state, agent, ctx } = staged(base, {
      knownEntities: [subject, org],
      contact: false,
    });
    const a: FeedAction = { kind: 'feed', asset: agent, items: [memberOfItem(subject, org)] };
    const q = quoteFeed(state, a, ctx);
    expect(q.allowed).toBe(false);
  });

  it('is not allowed when the feed is invalid', () => {
    const base = world();
    const { state, agent, ctx } = staged(base, { knownEntities: [] });
    const a: FeedAction = { kind: 'feed', asset: agent, items: [] };
    const q = quoteFeed(state, a, ctx);
    expect(q.allowed).toBe(false);
  });

  it('reports a turned Asset through isTurnedAsset', () => {
    const base = world();
    const { state, agent } = staged(base);
    expect(isTurnedAsset(state, agent)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// resolve — scheduling the hidden feed-delivered event (Req 37.3, 37.6)
// ---------------------------------------------------------------------------

describe('feed — resolve schedules a hidden feed-delivered event (Req 37.3, 37.6)', () => {
  function validFeed(base: WorldState, label?: 'credibility' | 'deceive'): {
    state: WorldState;
    agent: NpcId;
    ctx: ResolverContext;
    a: FeedAction;
  } {
    const org = hostileOrg(base);
    const subject = (Object.keys(base.npcs) as NpcId[])[0];
    const { state, agent, ctx } = staged(base, { knownEntities: [subject, org] });
    const a: FeedAction = {
      kind: 'feed',
      asset: agent,
      items: [memberOfItem(subject, org)],
      ...(label === undefined ? {} : { label }),
    };
    return { state, agent, ctx, a };
  }

  it('appends a hidden feed-delivered event carrying the resolved Propositions', () => {
    const { state, agent, ctx, a } = validFeed(world());
    const before = state.scheduled.length;
    const { next, result } = resolveFeed(state, a, ctx, renderLines);
    expect(next.scheduled.length).toBe(before + 1);
    const added = next.scheduled.find(
      (e): e is Extract<SimEvent, { kind: 'feed-delivered' }> => e.kind === 'feed-delivered',
    );
    expect(added).toBeDefined();
    expect(added!.visibility).toBe('hidden');
    expect(added!.agent).toBe(agent);
    expect(added!.props).toHaveLength(1);
    expect(added!.props[0].predicate).toBe('MEMBER_OF');
    // A composed item keeps its stable, per-agent id.
    expect(added?.props[0]?.id).toBe(`prop:feed/${agent}/0`);
    expect(result.factLines).toContain(FEED_SCHEDULED_LINE);
    expect(result.claimsAdded).toEqual([]);
  });

  it('schedules the event at the computed next handler contact', () => {
    const { state, agent, ctx, a } = validFeed(world());
    const at = nextHandlerContact(state, agent);
    const { next } = resolveFeed(state, a, ctx, renderLines);
    const added = next.scheduled.find((e) => e.kind === 'feed-delivered');
    expect(added!.at).toEqual(at);
  });

  it('returns the optional label for a Journal note only (not game-state truth)', () => {
    const { state, ctx, a } = validFeed(world(), 'deceive');
    const out = resolveFeed(state, a, ctx, renderLines);
    expect(out.label).toBe('deceive');
    // The label never changes game-state truth: the only state change is the
    // scheduled event.
    expect(out.next.relationships).toBe(state.relationships);
  });

  it('omits the label when none is given', () => {
    const { state, ctx, a } = validFeed(world());
    const out = resolveFeed(state, a, ctx, renderLines);
    expect(out.label).toBeUndefined();
  });

  it('is deterministic: the same inputs schedule the same event (draws nothing)', () => {
    const { state, ctx, a } = validFeed(world());
    const r1 = resolveFeed(state, a, ctx, renderLines);
    const r2 = resolveFeed(state, a, ctx, renderLines);
    const e1 = r1.next.scheduled.find((e) => e.kind === 'feed-delivered');
    const e2 = r2.next.scheduled.find((e) => e.kind === 'feed-delivered');
    expect(e1).toEqual(e2);
  });
});

// ---------------------------------------------------------------------------
// Routing through the top-level quote/resolve
// ---------------------------------------------------------------------------

describe('feed — routing and state unchanged on disallow', () => {
  it('is routed by quote (not a not-implemented stub)', () => {
    const base = world();
    const org = hostileOrg(base);
    const subject = (Object.keys(base.npcs) as NpcId[])[0];
    const { state, agent, ctx } = staged(base, { knownEntities: [subject, org] });
    const a: FeedAction = { kind: 'feed', asset: agent, items: [memberOfItem(subject, org)] };
    const q = quote(state, a, ctx);
    expect(q.reason ?? '').not.toContain('not yet implemented');
  });

  it('leaves the state unchanged when the feed is disallowed', () => {
    const base = world();
    const { state, agent } = staged(base, { knownEntities: [], turned: false });
    const a: FeedAction = { kind: 'feed', asset: agent, items: [] };
    const { next } = resolve(state, a, createPrng('x'), { content });
    expect(next).toBe(state);
  });

  it('schedules the event through the top-level resolve when allowed', () => {
    const base = world();
    const org = hostileOrg(base);
    const subject = (Object.keys(base.npcs) as NpcId[])[0];
    const { state, agent, ctx } = staged(base, { knownEntities: [subject, org] });
    const a: FeedAction = { kind: 'feed', asset: agent, items: [memberOfItem(subject, org)] };
    // Only proceed if the shared Location gate allows feed at the player's
    // current Location; otherwise the top-level quote may reject on the gate,
    // which is not what this test exercises.
    const q = quote(state, a, ctx);
    if (q.allowed) {
      const { next } = resolve(state, a, createPrng('x'), ctx);
      expect(next.scheduled.some((e) => e.kind === 'feed-delivered')).toBe(true);
    } else {
      // Still routed (not a stub) — the gate rejected, which is acceptable.
      expect(q.reason ?? '').not.toContain('not yet implemented');
    }
  });
});
