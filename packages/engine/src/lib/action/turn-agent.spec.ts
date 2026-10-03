/**
 * Tests for the turn-agent action (task 18.5; Requirements 11.3, 36.1, 36.2,
 * 36.3, 36.4, 36.5, 36.6, 36.7).
 *
 * These drive a generated {@link WorldState} from the real core pack through the
 * turn-agent resolver and the top-level {@link quote}/{@link resolve}, checking:
 *
 * - eligibility gates — custody / observed crack / evidence — are decided from
 *   Player-View and Case File data only (Req 36.1, 36.2);
 * - a successful turn flips the true allegiance to the Station, keeps the
 *   apparent allegiance, makes the NPC a `turned` Asset and shifts the Agenda,
 *   releasing custody with a suspicion penalty (Req 36.6, 36.7);
 * - every failure renders the identical refusal Fact Line and raises suspicion,
 *   regardless of the target's true allegiance (Req 36.5);
 * - determinism for a seed;
 * - routing: turn-agent is no longer the not-implemented stub.
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
  type EvaluatorKind,
  type PublicText,
} from '@tradecraft/content';

import { createPrng } from '../prng/prng.js';
import { TruthStore, type PredicateEvaluatorLookup } from '../truth/truth.js';
import type { Allegiance } from '../truth/truth.js';
import { ScenarioConfigSchema } from '../config/scenario-config.js';
import { generate, type GenerateInputs } from '../generate.js';
import { asTruth, revealTruth, type LocId, type NpcId, type OrgId } from '../model/core.js';
import type { WorldState } from '../model/state.js';
import { quote, resolve, visibleNpcsAt } from './action.js';
import {
  hostileOrgId,
  quoteTurnAgent,
  resolveTurnAgent,
  turnEligibility,
  TURN_ACCEPT_LINE,
  TURN_FAIL_SUSPICION,
  TURN_PHASE_COST,
} from './turn-agent.js';
import { TURN_REFUSAL_LINE } from '../recruit/turn.js';
import { assetStatus, newRelationship, type Custody, type Relationship } from '../recruit/asset.js';
import type { Observation, ResolverContext } from './result.js';
import type { TurnAgentAction } from './types.js';

// ---------------------------------------------------------------------------
// Core-pack fixtures (mirrors confront.spec.ts)
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

function world(seed = 'turn-alpha'): WorldState {
  return generate(seed, inputs());
}

/** A Truth Store that answers the allegiance predicates (kinds). */
function truth(): TruthStore {
  const lookup: PredicateEvaluatorLookup = {
    get: (predicate) =>
      predicate === 'IS_ALIAS_OF' ? ('alias' as EvaluatorKind) : undefined,
  };
  return TruthStore.create(lookup);
}

/** The render callback used in tests: observations to their lines/ids. */
function renderLines(_s: WorldState, obs: readonly Observation[]): string[] {
  return obs.map((o) => (o.kind === 'message' ? o.line : `prop:${o.prop.id}`));
}

/** A Prng whose `next()` always returns the given constant (coin control). */
function fixedPrng(value: number): ReturnType<typeof createPrng> {
  const base = createPrng('ignored');
  return { ...base, next: () => value };
}

/** A Location where at least one NPC is present this phase. */
function populatedLocation(state: WorldState): { loc: LocId; npcs: NpcId[] } {
  for (const loc of Object.keys(state.city.locations) as LocId[]) {
    const npcs = visibleNpcsAt(state, loc);
    if (npcs.length > 0) {
      return { loc, npcs };
    }
  }
  throw new Error('no populated Location in the generated world at this time');
}

/**
 * Stage the player at a populated, open Location with the first present NPC,
 * make that NPC a true hostile agent (so a turn can succeed) with a soft
 * composure, and seed a Relationship from the overrides. Returns the state, the
 * NPC and a resolver context.
 */
function staged(
  base: WorldState,
  rel: Partial<Relationship> = {},
  turnEvidence?: ResolverContext['turnEvidence'],
): { state: WorldState; npc: NpcId; ctx: ResolverContext; hostile: OrgId } {
  const { loc, npcs } = populatedLocation(base);
  const npc = npcs[0];
  const hostile = hostileOrgId(base);
  if (hostile === undefined) {
    throw new Error('no hostile org in the generated world');
  }
  const state: WorldState = {
    ...base,
    npcs: {
      ...base.npcs,
      [npc]: {
        ...base.npcs[npc],
        trueAllegiance: asTruth<Allegiance>({ org: hostile }),
        tradecraft: asTruth(0),
        securityConsciousness: asTruth(0),
        loyalty: asTruth(0.5),
      },
    },
    relationships: { ...base.relationships, [npc]: { ...newRelationship(npc), ...rel } },
    player: { ...base.player, loc },
    city: {
      ...base.city,
      locations: {
        ...base.city.locations,
        [loc]: {
          ...base.city.locations[loc],
          hours: { 0: true, 1: true, 2: true, 3: true },
        },
      },
    },
  };
  const ctx: ResolverContext = { content, truth: truth(), turnEvidence };
  return { state, npc, ctx, hostile };
}

// ---------------------------------------------------------------------------
// Eligibility gates (Req 36.1, 36.2)
// ---------------------------------------------------------------------------

describe('turnEligibility — gates (Req 36.1, 36.2)', () => {
  it('is null when there is no custody, crack or evidence', () => {
    const { state, npc, ctx } = staged(world());
    expect(turnEligibility(state, npc, ctx)).toBeNull();
  });

  it('is custody when the NPC is in open Station Custody', () => {
    const custody: Custody = { by: 'station', since: { day: 0, phase: 0 } };
    const { state, npc, ctx } = staged(world(), { custody });
    expect(turnEligibility(state, npc, ctx)).toBe('custody');
  });

  it('is cracking when the observed cover state is cracking or blown', () => {
    const { state, npc, ctx } = staged(world(), { coverState: 'cracking' });
    expect(turnEligibility(state, npc, ctx)).toBe('cracking');
    const blown = staged(world(), { coverState: 'blown' });
    expect(turnEligibility(blown.state, blown.npc, blown.ctx)).toBe('cracking');
  });

  it('is evidence when a talk scene is open and evidenceCount >= 1', () => {
    const base = world();
    const { npcs } = populatedLocation(base);
    const npc = npcs[0];
    const { state, ctx } = staged(base, {}, {
      [npc]: { evidenceCount: 2, sceneOpen: true },
    });
    expect(turnEligibility(state, npc, ctx)).toBe('evidence');
  });

  it('is not evidence when the scene is closed, even with evidence', () => {
    const base = world();
    const { npcs } = populatedLocation(base);
    const npc = npcs[0];
    const { state, ctx } = staged(base, {}, {
      [npc]: { evidenceCount: 5, sceneOpen: false },
    });
    expect(turnEligibility(state, npc, ctx)).toBeNull();
  });

  it('prefers custody over cracking and evidence (priority order)', () => {
    const custody: Custody = { by: 'station', since: { day: 0, phase: 0 } };
    const base = world();
    const { npcs } = populatedLocation(base);
    const npc = npcs[0];
    const { state, ctx } = staged(base, { custody, coverState: 'blown' }, {
      [npc]: { evidenceCount: 3, sceneOpen: true },
    });
    expect(turnEligibility(state, npc, ctx)).toBe('custody');
  });
});

// ---------------------------------------------------------------------------
// Quote (Req 36.1, 36.2)
// ---------------------------------------------------------------------------

describe('turn-agent — quote (Req 36.1, 36.2)', () => {
  it('is allowed with an eligible leverage and quotes the phase cost', () => {
    const custody: Custody = { by: 'station', since: { day: 0, phase: 0 } };
    const { state, npc, ctx } = staged(world(), { custody });
    const q = quoteTurnAgent(state, { kind: 'turn-agent', npc, lever: 'coercion' }, ctx);
    expect(q.allowed).toBe(true);
    expect(q.phases).toBe(TURN_PHASE_COST);
    expect(q.money).toBe(0);
  });

  it('quotes the offered money for a money lever', () => {
    const custody: Custody = { by: 'station', since: { day: 0, phase: 0 } };
    const { state, npc, ctx } = staged(world(), { custody });
    const q = quoteTurnAgent(state, { kind: 'turn-agent', npc, lever: 'money', offer: 250 }, ctx);
    expect(q.allowed).toBe(true);
    expect(q.money).toBe(250);
  });

  it('is not allowed when no leverage holds', () => {
    const { state, npc, ctx } = staged(world());
    const q = quoteTurnAgent(state, { kind: 'turn-agent', npc, lever: 'ego' }, ctx);
    expect(q.allowed).toBe(false);
    expect(q.reason ?? '').toContain('cannot turn');
  });

  it('rejects a negative money offer', () => {
    const custody: Custody = { by: 'station', since: { day: 0, phase: 0 } };
    const { state, npc, ctx } = staged(world(), { custody });
    const q = quoteTurnAgent(state, { kind: 'turn-agent', npc, lever: 'money', offer: -5 }, ctx);
    expect(q.allowed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Resolve — success (Req 36.6, 36.7)
// ---------------------------------------------------------------------------

describe('turn-agent — accepted (Req 36.6, 36.7)', () => {
  it('flips the true allegiance to the Station, keeps apparent, and turns the Asset', () => {
    const custody: Custody = { by: 'station', since: { day: 0, phase: 0 } };
    const { state, npc, ctx } = staged(world(), { custody, trust: 1 });
    const apparentBefore = state.npcs[npc].apparentAllegiance;
    const a: TurnAgentAction = { kind: 'turn-agent', npc, lever: 'coercion' };
    const { next, result } = resolveTurnAgent(state, a, fixedPrng(0), ctx, renderLines);

    // Req 36.6: true allegiance now the Station (written to the Truth Store).
    expect(ctx.truth && revealTruth(ctx.truth.allegiance(npc)!).org).toBe(state.station.org);
    // Apparent allegiance unchanged.
    expect(next.npcs[npc].apparentAllegiance).toBe(apparentBefore);
    // The NPC is now a turned Asset.
    const rel = next.relationships[npc];
    expect(rel.recruited).toBe(true);
    expect(assetStatus(rel)).toBe('turned');
    // The accept Fact Line is shown; no Claims added.
    expect(result.factLines).toContain(TURN_ACCEPT_LINE);
    expect(result.claimsAdded).toEqual([]);
  });

  it('releases Station Custody and emits a custody-released event with a suspicion penalty', () => {
    const custody: Custody = { by: 'station', since: { day: 0, phase: 0 } };
    const staged0 = staged(world(), { custody, trust: 1 });
    // Advance the current time to two phases into day 1 so there are 6 phases in
    // custody (4 phases/day). The resolver reads the relationship, not NPC
    // presence, so shifting time after staging is sound.
    const state: WorldState = { ...staged0.state, time: { day: 1, phase: 2 } };
    const { npc, ctx } = staged0;
    const a: TurnAgentAction = { kind: 'turn-agent', npc, lever: 'coercion' };
    const { next, result } = resolveTurnAgent(state, a, fixedPrng(0), ctx, renderLines);

    const rel = next.relationships[npc];
    expect(rel.custody).toBeUndefined(); // released
    // 1 day + 2 phases = 6 phases × 0.1 = 0.6 suspicion.
    expect(rel.suspicion).toBeCloseTo(0.6);
    expect(result.events.some((e) => e.kind === 'custody-released')).toBe(true);
  });

  it('includes the hostile org in the turned Asset access', () => {
    const custody: Custody = { by: 'station', since: { day: 0, phase: 0 } };
    const { state, npc, ctx, hostile } = staged(world(), { custody, trust: 1 });
    const a: TurnAgentAction = { kind: 'turn-agent', npc, lever: 'coercion' };
    const { next } = resolveTurnAgent(state, a, fixedPrng(0), ctx, renderLines);
    const access = revealTruth(next.relationships[npc].asset!.access);
    expect(access.orgs).toContain(hostile);
  });
});

// ---------------------------------------------------------------------------
// Resolve — refusal is identical regardless of ground truth (Req 36.5)
// ---------------------------------------------------------------------------

describe('turn-agent — refusal leaks nothing (Req 36.4, 36.5)', () => {
  it('renders the identical refusal line and raises suspicion on a failed turn', () => {
    const custody: Custody = { by: 'station', since: { day: 0, phase: 0 } };
    const { state, npc, ctx } = staged(world(), { custody });
    const a: TurnAgentAction = { kind: 'turn-agent', npc, lever: 'ego' };
    const { next, result } = resolveTurnAgent(state, a, fixedPrng(0.999999), ctx, renderLines);
    expect(result.factLines).toContain(TURN_REFUSAL_LINE);
    expect(next.relationships[npc].suspicion).toBeCloseTo(TURN_FAIL_SUSPICION);
    // The allegiance was not flipped.
    expect(assetStatus(next.relationships[npc])).toBe('none');
  });

  it('gives the same refusal line whether the target is hostile or innocent', () => {
    const custody: Custody = { by: 'station', since: { day: 0, phase: 0 } };
    const base = world();
    const hostileCase = staged(base, { custody });
    // An innocent target: true allegiance is the Station (not hostile) → always refuses.
    const innocentState: WorldState = {
      ...hostileCase.state,
      npcs: {
        ...hostileCase.state.npcs,
        [hostileCase.npc]: {
          ...hostileCase.state.npcs[hostileCase.npc],
          trueAllegiance: asTruth<Allegiance>({ org: hostileCase.state.station.org }),
        },
      },
    };
    const a: TurnAgentAction = { kind: 'turn-agent', npc: hostileCase.npc, lever: 'coercion' };
    // Hostile target with an unfavourable draw refuses; innocent refuses with no draw.
    const hostileRefuse = resolveTurnAgent(
      hostileCase.state,
      a,
      fixedPrng(0.999999),
      hostileCase.ctx,
      renderLines,
    );
    const innocentRefuse = resolveTurnAgent(
      innocentState,
      a,
      fixedPrng(0),
      { content, truth: truth() },
      renderLines,
    );
    expect(hostileRefuse.result.factLines).toEqual(innocentRefuse.result.factLines);
    expect(innocentRefuse.result.factLines).toContain(TURN_REFUSAL_LINE);
  });
});

// ---------------------------------------------------------------------------
// Determinism and routing
// ---------------------------------------------------------------------------

describe('turn-agent — determinism and routing', () => {
  it('is deterministic for a seed', () => {
    const custody: Custody = { by: 'station', since: { day: 0, phase: 0 } };
    const { state, npc, ctx } = staged(world(), { custody, trust: 0.5 });
    const a: TurnAgentAction = { kind: 'turn-agent', npc, lever: 'money', offer: 300 };
    const r1 = resolveTurnAgent(state, a, createPrng('seed-turn'), { ...ctx, truth: truth() }, renderLines);
    const r2 = resolveTurnAgent(state, a, createPrng('seed-turn'), { ...ctx, truth: truth() }, renderLines);
    expect(r1.result.factLines).toEqual(r2.result.factLines);
    expect(assetStatus(r1.next.relationships[npc])).toBe(
      assetStatus(r2.next.relationships[npc]),
    );
  });

  it('is routed by quote (not a not-implemented stub)', () => {
    const custody: Custody = { by: 'station', since: { day: 0, phase: 0 } };
    const { state, npc, ctx } = staged(world(), { custody });
    const q = quote(state, { kind: 'turn-agent', npc, lever: 'coercion' }, ctx);
    expect(q.reason ?? '').not.toContain('not yet implemented');
  });

  it('leaves the state unchanged when the turn is disallowed', () => {
    const { state, npc, ctx } = staged(world());
    const a: TurnAgentAction = { kind: 'turn-agent', npc, lever: 'ego' };
    const { next } = resolve(state, a, createPrng('x'), ctx);
    expect(next).toBe(state);
  });
});
